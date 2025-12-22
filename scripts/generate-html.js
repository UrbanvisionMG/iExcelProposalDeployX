const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Read system prompt
const systemPrompt = fs.readFileSync(path.join(__dirname, 'system-prompt.txt'), 'utf-8');

// Find all JSON files in data/proposals
const proposalsDir = path.join(__dirname, '..', 'data', 'proposals');
const outputDir = path.join(__dirname, '..', 'public', 'proposal');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Get all JSON files
const jsonFiles = fs.readdirSync(proposalsDir).filter(file => file.endsWith('.json'));

console.log(`Found ${jsonFiles.length} proposal(s) to process`);

// Process each JSON file
async function processProposal(filename) {
  const jsonPath = path.join(proposalsDir, filename);
  const proposalData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  
  console.log(`Processing: ${filename}`);
  
  // Prepare the prompt for Gemini
  const fullPrompt = `${systemPrompt}

---

PROPOSAL DATA TO FORMAT:

${JSON.stringify(proposalData, null, 2)}

---

Generate the complete HTML document now.`;

  // Estimate token count (rough: 1 token ≈ 4 characters)
  const estimatedTokens = Math.ceil(fullPrompt.length / 4);
  console.log(`Estimated input tokens: ${estimatedTokens}`);
  
  if (estimatedTokens > 950000) {
    console.warn(`WARNING: Input is very large (${estimatedTokens} tokens). May hit limits.`);
  }

  // Call Gemini API with error handling
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${process.env.GEMINI_API_KEY}`;
  
  console.log('Calling Gemini API...');
  
  let response;
  try {
    response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: fullPrompt }]
        }],
        generationConfig: {
          maxOutputTokens: 65000,
          temperature: 0.7
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Gemini API error: ${response.status}`);
      console.error(errorText);
      
      // If we hit token limits, try with reduced max output
      if (errorText.includes('token') || errorText.includes('limit') || response.status === 400) {
        console.log('Retrying with reduced output limit (32K tokens)...');
        
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: fullPrompt }]
            }],
            generationConfig: {
              maxOutputTokens: 32000,
              temperature: 0.7
            }
          })
        });
        
        if (!response.ok) {
          throw new Error(`Gemini API retry failed: ${response.status}`);
        }
      } else {
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
      }
    }
  } catch (error) {
    console.error('Error calling Gemini:', error);
    throw error;
  }

  const result = await response.json();
  
  if (!result.candidates || !result.candidates[0] || !result.candidates[0].content) {
    console.error('Invalid Gemini response:', JSON.stringify(result, null, 2));
    throw new Error(`Invalid Gemini response: ${JSON.stringify(result)}`);
  }
  
  // Check for finish reason
  const finishReason = result.candidates[0].finishReason;
  if (finishReason && finishReason !== 'STOP') {
    console.warn(`Warning: Generation finished with reason: ${finishReason}`);
    if (finishReason === 'MAX_TOKENS') {
      console.warn('Output was truncated due to token limit. HTML may be incomplete.');
    }
  }
  
  // Extract HTML from response
  let html = result.candidates[0].content.parts[0].text;
  
  // Remove markdown code fences if present
  html = html.replace(/^```html\n/, '').replace(/\n```$/, '');
  
  // Verify HTML looks valid
  if (!html.includes('<!DOCTYPE html>') && !html.includes('<html')) {
    console.warn('Generated content does not appear to be valid HTML');
  }
  
  // Determine output filename (use company name from JSON or filename)
  const companyName = proposalData.company_name || proposalData.companyName || filename.replace('.json', '');
  const outputFilename = companyName.toLowerCase().replace(/[^a-z0-9]/g, '') + '.html';
  const outputPath = path.join(outputDir, outputFilename);
  
  // Write HTML to file
  fs.writeFileSync(outputPath, html, 'utf-8');
  
  const fileSize = fs.statSync(outputPath).size;
  console.log(`✓ Generated: public/proposal/${outputFilename} (${Math.round(fileSize/1024)}KB)`);
  
  return {
    input: filename,
    output: outputFilename,
    url: `https://iexcelproposal.netlify.app/proposal/${outputFilename}`,
    size: fileSize,
    finishReason: finishReason
  };
}

// Main execution
(async () => {
  try {
    const results = [];
    
    for (const file of jsonFiles) {
      try {
        const result = await processProposal(file);
        results.push(result);
      } catch (error) {
        console.error(`Failed to process ${file}:`, error);
        results.push({
          input: file,
          error: error.message,
          success: false
        });
      }
    }
    
    console.log('\n=== Generation Complete ===');
    console.log(JSON.stringify(results, null, 2));
    
    // Write summary file
    fs.writeFileSync(
      path.join(__dirname, '..', 'generation-summary.json'),
      JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2)
    );
    
    // Exit with error if any failed
    const failures = results.filter(r => r.success === false);
    if (failures.length > 0) {
      console.error(`\n❌ ${failures.length} proposal(s) failed to generate`);
      process.exit(1);
    }
    
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
})();
