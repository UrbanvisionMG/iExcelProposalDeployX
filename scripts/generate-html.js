const fs = require('fs').promises;
const path = require('path');

async function generateHTML() {
  try {
    console.log('🚀 Starting proposal generation with Gemini 2.0 Flash Experimental...');
    
    // Read all JSON files from proposals directory
    const proposalsDir = path.join(process.cwd(), 'data', 'proposals');
    const outputDir = path.join(process.cwd(), 'public', 'proposal');
    
    const files = await fs.readdir(proposalsDir);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    
    // Filter to ONLY process files that DON'T have HTML yet
    const newFiles = [];
    for (const file of jsonFiles) {
      const htmlFile = path.join(outputDir, file.replace('.json', '.html'));
      try {
        await fs.access(htmlFile);
        console.log(`⏭️  Skipping ${file} (HTML already exists)`);
      } catch {
        newFiles.push(file);
      }
    }
    
    if (newFiles.length === 0) {
      console.log('✅ No new proposals to generate - all HTML files exist!');
      return;
    }
    
    console.log(`Found ${newFiles.length} NEW proposal(s) to generate`);
    
    for (const file of newFiles) {
      const filePath = path.join(proposalsDir, file);
      const proposalData = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      
      console.log(`\n🆕 Processing NEW: ${file}`);
      
      // Read system prompt
      const systemPrompt = await fs.readFile(
        path.join(process.cwd(), 'scripts', 'system-prompt.txt'), 
        'utf-8'
      );
      
      // Create the prompt
      const userPrompt = `Generate a professional HTML proposal based on this data:

Company: ${proposalData.company_name}
Proposal Type: ${proposalData.proposal_type}

Content (Markdown):
${proposalData.content_markdown}

Requirements:
1. Create a complete, standalone HTML file
2. Use modern, professional design with Tailwind CSS (via CDN)
3. Include proper styling with Google Fonts (Google Sans for headings, Roboto for body)
4. Make it responsive and mobile-friendly
5. Use a clean color scheme (blues/grays for professional look)
6. Include proper HTML structure with <!DOCTYPE>, <head>, and <body>
7. Add a header with company branding
8. Format the markdown content into beautiful HTML sections
9. Add a footer with contact information

Return ONLY the complete HTML code, no explanations or markdown formatting.`;

      console.log('Calling Gemini 2.0 Flash Experimental API...');

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemPrompt }]
          },
          contents: [{
            parts: [{ text: userPrompt }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('✅ Gemini 2.0 Flash Experimental response received');
      
      // Extract HTML from response
      let htmlContent = data.candidates[0].content.parts[0].text;
      
      // Clean up any markdown code fences if present
      htmlContent = htmlContent.replace(/```html\n?/g, '').replace(/```\n?/g, '');
      
      // Save HTML file
      await fs.mkdir(outputDir, { recursive: true });
      
      const outputFile = path.join(outputDir, file.replace('.json', '.html'));
      await fs.writeFile(outputFile, htmlContent);
      
      console.log(`✅ Generated: ${outputFile}`);
      
      // Log token usage if available
      if (data.usageMetadata) {
        console.log(`   Tokens - Input: ${data.usageMetadata.promptTokenCount}, Output: ${data.usageMetadata.candidatesTokenCount}`);
      }
    }
    
    console.log(`\n✅ Generated ${newFiles.length} new proposal(s) successfully!`);
    
  } catch (error) {
    console.error('❌ Error generating proposals:', error.message);
    process.exit(1);
  }
}

generateHTML();
