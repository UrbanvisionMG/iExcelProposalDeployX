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
  
  console.log(`\n========================================`);
  console.log(`Processing: ${filename}`);
  console.log(`========================================`);
  
  // Prepare the prompt for Gemini
  const fullPrompt = `${systemPrompt}

---

PROPOSAL DATA TO FORMAT:

${JSON.stringify(proposalData, null, 2)}

---

Generate the complete HTML document now. Remember:
- Do not summarize
- Do not change any language
- Do not leave out any words
- Output ONLY the HTML, no explanations or markdown code blocks`;

  // Estimate token count (rough: 1 token ≈ 4 characters)
  const estimatedInputTokens = Math.ceil(fullPrompt.length / 4);
  const estimatedOutputNeeded = Math.ceil(JSON.stringify(proposalData).length / 2); // Rough estimate of HTML size
  
  console.log(`Input size: ~${estimatedInputTokens.toLocaleString()} tokens`);
  console.log(`Estimated output needed: ~${estimatedOutputNeeded.toLocaleString()} tokens`);
  
  if (estimatedInputTokens > 900000) {
    console.warn(`⚠️  WARNING: Input is very large (${estimatedInputTokens.toLocaleString()} tokens)`);
  }

  // Call Gemini API with full quality settings
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  
  console.log(`Calling Gemini API...`);
  
  let response;
  let retryAttempt = 0;
  const maxRetries = 2;
  
  // Try with progressively lower token limits if needed
  const tokenLimits = [65000, 32000, 16000];
  
  for (let i = 0; i < tokenLimits.length && i <= retryAttempt; i++) {
    const currentLimit = tokenLimits[i];
    
    if (i > 0) {
      console.log(`\n⚠️  Retrying with reduced output limit: ${currentLimit.toLocaleString()} tokens`);
    }
    
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
            maxOutputTokens: currentLimit,
            temperature: 0.7,
            topP: 0.95,
            topK: 40
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Gemini API error (${response.status}):`, errorText.substring(0, 500));
        
        // Check if it's a token limit issue
        if (errorText.includes('token') || errorText.includes('limit') || errorText.includes('INVALID_ARGUMENT') || response.status === 400) {
          retryAttempt++;
          if (retryAttempt < maxRetries) {
            console.log(`Detected token limit issue, will retry with lower limit...`);
            continue; // Try next lower limit
          }
        }
        
        throw new Error(`Gemini API error: ${response.status}`);
      }
      
      // Success! Break out of retry loop
      break;
      
    } catch (error) {
      if (retryAttempt < maxRetries - 1) {
        retryAttempt++;
        console.error(`Error: ${error.message}`);
        continue;
      } else {
        throw error;
      }
    }
  }

  if (!response || !response.ok) {
    throw new Error('Failed to get valid response from Gemini after all retries');
  }

  const result = await response.json();
  
  // Validate response structure
  if (!result.candidates || !result.candidates[0] || !result.candidates[0].content) {
    console.error('❌ Invalid Gemini response structure:', JSON.stringify(result, null, 2));
    throw new Error('Invalid Gemini response');
  }
  
  // Check for finish reason
  const candidate = result.candidates[0];
  const finishReason = candidate.finishReason;
  
  console.log(`Gemini finish reason: ${finishReason || 'STOP'}`);
  
  if (finishReason === 'MAX_TOKENS') {
    console.warn(`⚠️  WARNING: Output was truncated due to token limit.`);
    console.warn(`   The HTML may be incomplete. Consider splitting this proposal into multiple parts.`);
  } else if (finishReason === 'SAFETY') {
    throw new Error('Content was blocked by safety filters');
  } else if (finishReason && finishReason !== 'STOP' && finishReason !== 'END_TURN') {
    console.warn(`⚠️  Unexpected finish reason: ${finishReason}`);
  }
  
  // Extract HTML from response
  let html = candidate.content.parts[0].text;
  
  // Clean up any markdown code fences
  html = html.replace(/^```html\n?/i, '').replace(/\n?```$/i, '');
  html = html.trim();
  
  // Verify HTML looks valid
  if (!html.includes('<!DOCTYPE html>') && !html.toLowerCase().includes('<html')) {
    console.error('❌ Generated content does not appear to be valid HTML');
    console.error('First 500 characters:', html.substring(0, 500));
    throw new Error('Invalid HTML output from Gemini');
  }
  
  // Verify required branding elements
  const hasLogo = html.includes('iexcel_logo.png');
  const hasTagline = html.includes('Digital Marketing') || html.includes('Focused On Growth');
  
  if (!hasLogo) {
    console.warn('⚠️  WARNING: Logo URL not found in generated HTML');
  }
  if (!hasTagline) {
    console.warn('⚠️  WARNING: Company tagline not found in generated HTML');
  }
  
  // Determine output filename
  const companyName = proposalData.company_name || proposalData.companyName || proposalData.company || filename.replace('.json', '');
  const outputFilename = companyName.toLowerCase().replace(/[^a-z0-9]/g, '') + '.html';
  const outputPath = path.join(outputDir, outputFilename);
  
  // Write HTML to file
  fs.writeFileSync(outputPath, html, 'utf-8');
  
  const fileSize = fs.statSync(outputPath).size;
  const fileSizeKB = Math.round(fileSize / 1024);
  
  console.log(`\n✅ SUCCESS!`);
  console.log(`   Output: public/proposal/${outputFilename}`);
  console.log(`   Size: ${fileSizeKB}KB`);
  console.log(`   URL: https://iexcelproposal.netlify.app/proposal/${outputFilename}`);
  
  return {
    input: filename,
    output: outputFilename,
    url: `https://iexcelproposal.netlify.app/proposal/${outputFilename}`,
    sizeKB: fileSizeKB,
    finishReason: finishReason || 'STOP',
    success: true,
    hasLogo: hasLogo,
    hasTagline: hasTagline
  };
}

// Main execution
(async () => {
  const startTime = Date.now();
  
  try {
    console.log(`\n🚀 Starting proposal generation...`);
    console.log(`System prompt loaded: ${Math.ceil(systemPrompt.length / 4).toLocaleString()} tokens\n`);
    
    const results = [];
    
    for (const file of jsonFiles) {
      try {
        const result = await processProposal(file);
        results.push(result);
      } catch (error) {
        console.error(`\n❌ FAILED: ${file}`);
        console.error(`   Error: ${error.message}`);
        results.push({
          input: file,
          error: error.message,
          success: false
        });
      }
    }
    
    const endTime = Date.now();
    const durationSec = Math.round((endTime - startTime) / 1000);
    
    console.log(`\n========================================`);
    console.log(`GENERATION COMPLETE`);
    console.log(`========================================`);
    console.log(`Total time: ${durationSec} seconds`);
    console.log(`Proposals processed: ${results.length}`);
    console.log(`Successful: ${results.filter(r => r.success).length}`);
    console.log(`Failed: ${results.filter(r => !r.success).length}`);
    
    // Write summary file
    const summary = {
      timestamp: new Date().toISOString(),
      durationSeconds: durationSec,
      results: results
    };
    
    fs.writeFileSync(
      path.join(__dirname, '..', 'generation-summary.json'),
      JSON.stringify(summary, null, 2)
    );
    
    console.log(`\nSummary written to: generation-summary.json`);
    
    // Exit with error if any failed
    const failures = results.filter(r => !r.success);
    if (failures.length > 0) {
      console.error(`\n⚠️  ${failures.length} proposal(s) failed to generate`);
      failures.forEach(f => console.error(`   - ${f.input}: ${f.error}`));
      process.exit(1);
    }
    
    console.log(`\n✅ All proposals generated successfully!\n`);
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
})();
