const fs = require('fs');
const path = require('path');

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

  // Call Gemini API
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=' + process.env.GEMINI_API_KEY, {
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
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  
  // Extract HTML from response
  let html = result.candidates[0].content.parts[0].text;
  
  // Remove markdown code fences if present
  html = html.replace(/^```html\n/, '').replace(/\n```$/, '');
  
  // Determine output filename (use company name from JSON or filename)
  const companyName = proposalData.company_name || proposalData.companyName || filename.replace('.json', '');
  const outputFilename = companyName.toLowerCase().replace(/[^a-z0-9]/g, '') + '.html';
  const outputPath = path.join(outputDir, outputFilename);
  
  // Write HTML to file
  fs.writeFileSync(outputPath, html, 'utf-8');
  
  console.log(`✓ Generated: public/proposal/${outputFilename}`);
  
  return {
    input: filename,
    output: outputFilename,
    url: `https://iexcelproposal.netlify.app/proposal/${outputFilename}`
  };
}

// Main execution
(async () => {
  try {
    const results = [];
    
    for (const file of jsonFiles) {
      const result = await processProposal(file);
      results.push(result);
    }
    
    console.log('\n=== Generation Complete ===');
    console.log(JSON.stringify(results, null, 2));
    
    // Write summary file
    fs.writeFileSync(
      path.join(__dirname, '..', 'generation-summary.json'),
      JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2)
    );
    
  } catch (error) {
    console.error('Error generating proposals:', error);
    process.exit(1);
  }
})();
