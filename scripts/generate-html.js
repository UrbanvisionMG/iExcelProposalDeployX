const fs = require('fs').promises;
const path = require('path');

async function generateHTML() {
  try {
    console.log('🚀 Starting proposal generation with Claude Sonnet 4.5...');
    
    // Read all JSON files from proposals directory
    const proposalsDir = path.join(process.cwd(), 'data', 'proposals');
    const files = await fs.readdir(proposalsDir);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    
    if (jsonFiles.length === 0) {
      console.log('✅ No proposals to generate - folder is clean!');
      return;
    }
    
    console.log(`Found ${jsonFiles.length} proposal(s) to generate\n`);
    
    for (const file of jsonFiles) {
      const filePath = path.join(proposalsDir, file);
      const proposalData = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      
      console.log(`Processing: ${file}`);
      
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

      console.log('Calling Claude API...');

      // Call Claude API
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 8192,
          system: systemPrompt,
          messages: [{
            role: 'user',
            content: userPrompt
          }]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Claude API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('✅ Claude response received');
      
      // Extract HTML from response
      let htmlContent = data.content[0].text;
      
      // Clean up any markdown code fences if present
      htmlContent = htmlContent.replace(/```html\n?/g, '').replace(/```\n?/g, '');
      
      // Save HTML file
      const outputDir = path.join(process.cwd(), 'public', 'proposal');
      await fs.mkdir(outputDir, { recursive: true });
      
      const outputFile = path.join(outputDir, file.replace('.json', '.html'));
      await fs.writeFile(outputFile, htmlContent);
      
      console.log(`✅ Generated: ${file.replace('.json', '.html')}`);
      
      // Log token usage
      console.log(`   Tokens - Input: ${data.usage.input_tokens}, Output: ${data.usage.output_tokens}`);
      
      // DELETE THE JSON FILE AFTER SUCCESSFUL GENERATION
      await fs.unlink(filePath);
      console.log(`🗑️  Deleted: ${file}\n`);
    }
    
    console.log(`✅ Generated ${jsonFiles.length} proposal(s) with Claude Sonnet 4.5!`);
    
  } catch (error) {
    console.error('❌ Error generating proposals:', error.message);
    process.exit(1);
  }
}

generateHTML();
