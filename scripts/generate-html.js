const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { execSync } = require('child_process');

// Read system prompt
const systemPrompt = fs.readFileSync(path.join(__dirname, 'system-prompt.txt'), 'utf-8');

const proposalsDir = path.join(__dirname, '..', 'data', 'proposals');
const outputDir = path.join(__dirname, '..', 'public', 'proposal');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Get changed files from git
let changedFiles = [];
try {
  const gitDiff = execSync('git diff --name-only HEAD~1 HEAD', { encoding: 'utf-8' });
  changedFiles = gitDiff
    .split('\n')
    .filter(f => f.startsWith('data/proposals/') && f.endsWith('.json'))
    .map(f => path.basename(f));
  
  console.log(`\n📝 Detected ${changedFiles.length} changed proposal(s):`);
  changedFiles.forEach(f => console.log(`   - ${f}`));
} catch (e) {
  console.log('⚠️  Could not detect changes, processing all files...');
  changedFiles = fs.readdirSync(proposalsDir).filter(file => file.endsWith('.json'));
}

// If no changes detected, process all (fallback)
if (changedFiles.length === 0) {
  changedFiles = fs.readdirSync(proposalsDir).filter(file => file.endsWith('.json'));
  console.log(`\n📁 Processing all ${changedFiles.length} proposal(s)`);
}

console.log(`\n🚀 Starting proposal generation...`);
console.log(`System prompt loaded: ${Math.ceil(systemPrompt.length / 4).toLocaleString()} tokens\n`);

// Process each changed file
async function processProposal(filename) {
  const jsonPath = path.join(proposalsDir, filename);
  const proposalData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  
  console.log(`========================================`);
  console.log(`Processing: ${filename}`);
  console.log(`========================================`);
  
  const fullPrompt = `${systemPrompt}\n\n---\n\nPROPOSAL DATA TO FORMAT:\n\n${JSON.stringify(proposalData, null, 2)}\n\n---\n\nGenerate the complete HTML document now.`;
  
  const estimatedInputTokens = Math.ceil(fullPrompt.length / 4);
  const estimatedOutputNeeded = Math.ceil(JSON.stringify(proposalData).length / 2);
  
  console.log(`Input size: ~${estimatedInputTokens.toLocaleString()} tokens`);
  console.log(`Estimated output needed: ~${estimatedOutputNeeded.toLocaleString()} tokens`);
  
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${process.env.GEMINI_API_KEY}`;
  
  console.log(`Calling Gemini API...`);
  
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: {
          maxOutputTokens: 32000,
          temperature: 0.7,
          topP: 0.95,
          topK: 40
        }
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.candidates || !data.candidates[0]) {
      throw new Error('No response from model');
    }

    const finishReason = data.candidates[0].finishReason;
    console.log(`Gemini finish reason: ${finishReason}`);

    let generatedHTML = data.candidates[0].content.parts[0].text;
    generatedHTML = generatedHTML.replace(/```html\n?/g, '').replace(/```\n?$/g, '').trim();

    // Create output filename
    const companyName = proposalData.company_name || filename.replace('.json', '');
    const outputFilename = companyName.toLowerCase().replace(/[^a-z0-9]/g, '') + '.html';
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

// Process all changed files
(async () => {
  const startTime = Date.now();
  const results = [];

  for (const file of changedFiles) {
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

  console.log(`✅ All proposals generated successfully!`);
})();
