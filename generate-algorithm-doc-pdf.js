/**
 * NDH AED Prediction Algorithm Documentation PDF Generator
 * Generates PDF from markdown with proper LaTeX/MathJax rendering
 * 
 * @version 1.1.0
 * @date 2026-01-04
 */

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

// Read the markdown file
const markdownPath = path.join(__dirname, 'docs', 'NDH_AED_Prediction_Algorithm_Technical_Document.md');
const finalOutputPath = path.join(__dirname, 'docs', 'NDH_AED_Prediction_Algorithm_Technical_Document.pdf');
// Use temp file to avoid lock issues, then rename
const tempOutputPath = path.join(__dirname, 'docs', `temp_pdf_${Date.now()}.pdf`);
const outputPath = tempOutputPath;

async function generatePDF() {
    // Dynamic import for puppeteer
    const puppeteer = require('puppeteer');
    
    console.log('Reading markdown file...');
    let markdown = fs.readFileSync(markdownPath, 'utf8');
    
    // Configure marked
    marked.setOptions({
        gfm: true,
        breaks: false,
        pedantic: false
    });
    
    // Protect math expressions from marked processing
    const mathBlocks = [];
    const mathInline = [];
    
    // Protect display math $$...$$
    markdown = markdown.replace(/\$\$([^$]+)\$\$/g, (match, content) => {
        mathBlocks.push(content.trim());
        return `%%MATHBLOCK${mathBlocks.length - 1}%%`;
    });
    
    // Protect inline math $...$
    markdown = markdown.replace(/\$([^$\n]+)\$/g, (match, content) => {
        mathInline.push(content.trim());
        return `%%MATHINLINE${mathInline.length - 1}%%`;
    });
    
    // Convert markdown to HTML
    let html = marked.parse(markdown);
    
    // Restore math expressions with proper MathJax delimiters
    html = html.replace(/%%MATHBLOCK(\d+)%%/g, (match, index) => {
        return `<div class="math-block">\\[${mathBlocks[parseInt(index)]}\\]</div>`;
    });
    
    html = html.replace(/%%MATHINLINE(\d+)%%/g, (match, index) => {
        return `\\(${mathInline[parseInt(index)]}\\)`;
    });
    
    console.log(`Found ${mathBlocks.length} display formulas and ${mathInline.length} inline formulas`);
    
    console.log('Launching browser...');
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Set content with MathJax for LaTeX rendering
    const fullHTML = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>NDH AED Prediction Algorithm - Technical Documentation</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 10.5pt;
            line-height: 1.65;
            color: #1D1D1F;
            background: #FFFFFF;
            padding: 0;
            max-width: 100%;
        }
        
        h1 {
            font-size: 24pt;
            font-weight: 700;
            color: #007AFF;
            margin-top: 0;
            margin-bottom: 8px;
            page-break-after: avoid;
        }
        
        h2 {
            font-size: 16pt;
            font-weight: 600;
            color: #1D1D1F;
            margin-top: 28px;
            margin-bottom: 14px;
            padding-bottom: 6px;
            border-bottom: 2px solid #007AFF;
            page-break-after: avoid;
        }
        
        h3 {
            font-size: 13pt;
            font-weight: 600;
            color: #5856D6;
            margin-top: 22px;
            margin-bottom: 10px;
            page-break-after: avoid;
        }
        
        h4 {
            font-size: 11pt;
            font-weight: 600;
            color: #1D1D1F;
            margin-top: 18px;
            margin-bottom: 8px;
            page-break-after: avoid;
        }
        
        p {
            margin-bottom: 10px;
            text-align: justify;
        }
        
        strong {
            font-weight: 600;
        }
        
        /* Tables */
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 14px 0;
            font-size: 9.5pt;
            page-break-inside: avoid;
        }
        
        th {
            background: #007AFF;
            color: #FFFFFF;
            font-weight: 600;
            padding: 8px 10px;
            text-align: left;
            border: 1px solid #007AFF;
        }
        
        td {
            padding: 7px 10px;
            border: 1px solid #E5E5EA;
            vertical-align: top;
        }
        
        tr:nth-child(even) {
            background: #F5F5F7;
        }
        
        /* Code blocks */
        pre {
            background: #1D1D1F;
            color: #F5F5F7;
            padding: 14px 18px;
            border-radius: 6px;
            overflow-x: auto;
            font-family: 'JetBrains Mono', 'Consolas', 'Monaco', monospace;
            font-size: 9pt;
            line-height: 1.5;
            margin: 14px 0;
            page-break-inside: avoid;
        }
        
        code {
            font-family: 'JetBrains Mono', 'Consolas', 'Monaco', monospace;
            font-size: 9.5pt;
            background: #F0F0F5;
            padding: 1px 5px;
            border-radius: 3px;
        }
        
        pre code {
            background: transparent;
            padding: 0;
            font-size: 9pt;
        }
        
        /* Math formulas */
        .math-block {
            background: linear-gradient(135deg, #F8F9FA 0%, #F0F2F5 100%);
            border-left: 4px solid #007AFF;
            padding: 16px 20px;
            margin: 16px 0;
            border-radius: 0 6px 6px 0;
            overflow-x: auto;
            page-break-inside: avoid;
            text-align: center;
        }
        
        mjx-container {
            overflow-x: auto;
            max-width: 100%;
        }
        
        /* Lists */
        ul, ol {
            margin: 10px 0 14px 24px;
        }
        
        li {
            margin-bottom: 5px;
        }
        
        /* Horizontal rules */
        hr {
            border: none;
            border-top: 1px solid #E5E5EA;
            margin: 25px 0;
        }
        
        /* Links */
        a {
            color: #007AFF;
            text-decoration: none;
        }
        
        /* Blockquotes */
        blockquote {
            border-left: 4px solid #5856D6;
            padding-left: 18px;
            margin: 14px 0;
            color: #666;
            font-style: italic;
        }
        
        /* Keep content together */
        h3, h4 {
            page-break-after: avoid;
        }
        
        table, pre, .math-block {
            page-break-inside: avoid;
        }
        
        /* Version subtitle */
        h2:first-of-type {
            color: #5856D6;
            font-size: 14pt;
            border-bottom: none;
            margin-top: 0;
        }
        
        /* Loading indicator */
        #loading {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20pt;
            z-index: 9999;
        }
        
        #loading.done {
            display: none;
        }
    </style>
</head>
<body>
    <div id="loading">Loading MathJax...</div>
    ${html}
    <script>
        window.MathJax = {
            tex: {
                inlineMath: [['\\\\(', '\\\\)']],
                displayMath: [['\\\\[', '\\\\]']],
                processEscapes: true,
                processEnvironments: true
            },
            options: {
                skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
            },
            svg: {
                fontCache: 'global'
            },
            startup: {
                pageReady: function() {
                    return MathJax.startup.defaultPageReady().then(function() {
                        document.getElementById('loading').classList.add('done');
                        window.mathJaxReady = true;
                        console.log('MathJax rendering complete!');
                    });
                }
            }
        };
    </script>
    <script id="MathJax-script" src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
</body>
</html>
    `;
    
    await page.setContent(fullHTML, { waitUntil: 'networkidle0' });
    
    // Wait for MathJax to render
    console.log('Waiting for MathJax to render formulas...');
    try {
        // Wait for the mathJaxReady flag
        await page.waitForFunction(() => window.mathJaxReady === true, { timeout: 30000 });
        console.log('MathJax rendering complete!');
    } catch (e) {
        console.log('MathJax timeout - trying alternative wait...');
        // Fallback: just wait a bit longer
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // Additional wait for SVG rendering
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('Generating PDF...');
    await page.pdf({
        path: outputPath,
        format: 'A4',
        printBackground: true,
        margin: {
            top: '22mm',
            bottom: '22mm',
            left: '18mm',
            right: '18mm'
        },
        displayHeaderFooter: true,
        headerTemplate: `
            <div style="font-size: 8px; color: #86868B; width: 100%; text-align: center; padding: 10px 0; border-bottom: 0.5px solid #E5E5EA;">
                NDH AED Prediction Algorithm - Technical Documentation v3.0.78
            </div>
        `,
        footerTemplate: `
            <div style="font-size: 8px; color: #86868B; width: 100%; padding: 10px 25px; display: flex; justify-content: space-between;">
                <span>North District Hospital</span>
                <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
                <span>January 4, 2026</span>
            </div>
        `
    });
    
    await browser.close();
    
    // Try to rename to final path
    try {
        if (fs.existsSync(finalOutputPath)) {
            fs.unlinkSync(finalOutputPath);
        }
        fs.renameSync(tempOutputPath, finalOutputPath);
        console.log('✅ PDF generated successfully: ' + finalOutputPath);
    } catch (renameErr) {
        console.log('⚠️ Could not overwrite original PDF (may be locked)');
        console.log('✅ PDF saved to: ' + tempOutputPath);
        console.log('   Please close the original PDF and run again, or manually rename the temp file.');
    }
}

// Run
generatePDF().catch(err => {
    console.error('Error generating PDF:', err);
    process.exit(1);
});
