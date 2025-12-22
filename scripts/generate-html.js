const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Read system prompt
const systemPrompt = fs.readFileSync(path.join(__dirname, 'system-prompt.txt'), 'utf-8');

const proposalsDir = path.join(__dirname, '..', 'data', 'proposals');
const outputDir = path.join(__dirname, '..', 'public', 'proposal');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Get files to process from environment or process all
let filesToProcess = [];
if (process.env.CHANGED_FILES) {
  filesToProcess = process.env.CHANGED_FILES
    .split('\n')
    .map(f => f.trim())
    .filter(f => f.endsWith('.json'))
    .map(f => path.basename(f));
  
  if (filesToProcess.length > 0) {
    console.log(`\n📝 Processing ${filesToProcess.length} changed file(s):`);
    filesToProcess.forEach(f => console.log(`   - ${f}`));
  }
}

// Fallback to all files if none specified
if (filesToProcess.length === 0) {
  filesToProcess = fs.readdirSync(proposalsDir).filter(file => file.endsWith('.json'));
  console.log(`\n📁 Processing all ${filesToProcess.length} proposal(s)`);
}

console.log(`\n🚀 Starting proposal generation with Claude Sonnet 4...`);
console.log(`System prompt loaded: ${Math.ceil(systemPrompt.length / 4).toLocaleString()} tokens\n`);

// Process proposal
async function processProposal(filename) {
  const jsonPath = path.join(proposalsDir, filename);
  const proposalData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  
  console.log(`========================================`);
  console.log(`Processing: ${filename}`);
  console.log(`========================================`);
  
  const fullPrompt = `${systemPrompt}\n\n---\n\nPROPOSAL DATA TO FORMAT:\n\n${JSON.stringify(proposalData, null, 2)}\n\n---\n\nGenerate the complete HTML document now.`;
  
  const estimatedInputTokens = Math.ceil(fullPrompt.length / 4);
  
  console.log(`Input size: ~${estimatedInputTokens.toLocaleString()} tokens`);
  console.log(`Calling Claude Sonnet 4 API...`);
  
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16000,
        messages: [{
          role: 'user',
          content: fullPrompt
        }]
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API error ${response.status}: ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    
    console.log(`Claude response received`);
    console.log(`Tokens: ${data.usage?.input_tokens} in, ${data.usage?.output_tokens} out`);

    let generatedHTML = data.content[0].text;
    
    // Remove markdown code fences if present
    generatedHTML = generatedHTML.replace(/```html\n?/g, '').replace(/```\n?$/g, '').trim();

    // Use JSON filename for HTML output
    const outputFilename = filename.replace('.json', '.html');
    const outputPath = path.join(outputDir, outputFilename);

    fs.writeFileSync(outputPath, generatedHTML, 'utf-8');

    const fileSize = Math.ceil(fs.statSync(outputPath).size / 1024);
    console.log(`✅ SUCCESS!`);
    console.log(`   Output: public/proposal/${outputFilename}`);
    console.log(`   Size: ${fileSize}KB`);
    console.log(`   URL: https://iexcelproposal.netlify.app/proposal/${outputFilename}`);

    return { filename, success: true };

  } catch (error) {
    console.error(`❌ FAILED: ${filename}`);
    console.error(`   Error: ${error.message}`);
    return { filename, success: false, error: error.message };
  }
}

// Process all files
(async () => {
  const startTime = Date.now();
  const results = [];

  for (const file of filesToProcess) {
    const result = await processProposal(file);
    results.push(result);
  }

  const totalTime = Math.ceil((Date.now() - startTime) / 1000);
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`\n========================================`);
  console.log(`GENERATION COMPLETE`);
  console.log(`========================================`);
  console.log(`Total time: ${totalTime} seconds`);
  console.log(`Proposals processed: ${results.length}`);
  console.log(`Successful: ${successful}`);
  console.log(`Failed: ${failed}\n`);

  if (failed > 0) {
    console.log(`⚠️  ${failed} proposal(s) failed to generate`);
    results.filter(r => !r.success).forEach(r => {
      console.log(`   - ${r.filename}: ${r.error}`);
    });
    process.exit(1);
  }

  console.log(`✅ All proposals generated successfully with Claude Sonnet 4!`);
})();
