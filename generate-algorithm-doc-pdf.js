/**
 * NDH AED Prediction Algorithm Documentation PDF Generator
 * Generates PDF from markdown with proper LaTeX/MathJax rendering
 * 
 * @version 1.2.0
 * @date 2026-01-05
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

function formatHKTNow() {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Hong_Kong',
        year: 'numeric',
        month: 'long',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    return `${fmt.format(now)} HKT`;
}

function readPackageVersion() {
    try {
        const pkgPath = path.join(__dirname, 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return pkg?.version || 'unknown';
    } catch {
        return 'unknown';
    }
}

async function generatePDF() {
    // Dynamic import for puppeteer
    const puppeteer = require('puppeteer');
    
    console.log('Reading markdown file...');
    let markdown = fs.readFileSync(markdownPath, 'utf8');

    const appVersion = readPackageVersion();
    const generatedAtHKT = formatHKTNow();
    
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
            font-size: 9.5pt;
            line-height: 1.45;
            color: #1D1D1F;
            background: #FFFFFF;
            padding: 0;
            max-width: 100%;
        }

        /* Apple-style layout helpers */
        .page-break {
            page-break-before: always;
        }

        .cover {
            /* Compact cover so TOC can sit on the same first page (reduce blank spaces) */
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            padding: 28px 28px;
            border: 1px solid #E5E5EA;
            border-radius: 16px;
            background: linear-gradient(180deg, #FFFFFF 0%, #F5F5F7 100%);
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.08);
            page-break-inside: avoid;
            break-inside: avoid-page;
        }

        .cover-badge {
            display: inline-flex;
            align-self: flex-start;
            gap: 8px;
            font-size: 10pt;
            font-weight: 600;
            color: #1D1D1F;
            background: rgba(0, 122, 255, 0.12);
            border: 1px solid rgba(0, 122, 255, 0.22);
            padding: 8px 12px;
            border-radius: 999px;
            margin-bottom: 14px;
        }

        .cover-title {
            font-size: 26pt;
            line-height: 1.1;
            margin: 0 0 10px 0;
            color: #007AFF;
            letter-spacing: -0.02em;
        }

        .cover-subtitle {
            font-size: 14pt;
            font-weight: 600;
            color: #5856D6;
            margin-bottom: 14px;
        }

        .cover-meta {
            margin-top: 10px;
            background: rgba(255, 255, 255, 0.72);
            border: 1px solid #E5E5EA;
            border-radius: 12px;
            padding: 12px 14px;
        }

        .cover-meta-row {
            display: flex;
            gap: 12px;
            padding: 6px 0;
            border-bottom: 1px solid #E5E5EA;
        }

        .cover-meta-row:last-child {
            border-bottom: none;
        }

        .cover-meta-row .k {
            width: 150px;
            color: #6E6E73;
            font-weight: 600;
        }

        .cover-meta-row .v {
            flex: 1;
            color: #1D1D1F;
            font-weight: 600;
        }

        .cover-gap {
            height: 12px;
        }

        .toc {
            border: 1px solid #E5E5EA;
            border-radius: 16px;
            background: #FFFFFF;
            box-shadow: 0 12px 28px rgba(0, 0, 0, 0.06);
            padding: 14px 14px 8px 14px;
            margin-top: 0;
            page-break-inside: avoid;
            break-inside: avoid-page;
        }

        .toc-header {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            padding: 6px 4px 12px 4px;
            border-bottom: 1px solid #E5E5EA;
            margin-bottom: 10px;
        }

        .toc-title {
            font-size: 16pt;
            font-weight: 700;
            color: #1D1D1F;
            letter-spacing: -0.01em;
        }

        .toc-note {
            font-size: 9.5pt;
            color: #6E6E73;
            font-weight: 600;
        }

        .toc-section {
            padding: 8px 6px 4px 6px;
        }

        .toc-section-title {
            font-size: 10pt;
            font-weight: 700;
            color: #6E6E73;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            margin: 6px 0 8px 0;
        }

        .toc-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 6px 8px;
            border-radius: 10px;
            page-break-inside: avoid;
            break-inside: avoid;
        }

        .toc-item:nth-child(even) {
            background: #F5F5F7;
        }

        .toc-num {
            width: 22px;
            height: 22px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 7px;
            background: rgba(0, 122, 255, 0.12);
            color: #007AFF;
            font-weight: 800;
            font-size: 9.5pt;
            flex: 0 0 auto;
        }

        .toc-item a {
            flex: 1;
            font-weight: 700;
            color: #1D1D1F;
        }

        .toc-pill {
            flex: 0 0 auto;
            font-size: 9pt;
            font-weight: 700;
            color: #6E6E73;
            background: rgba(110, 110, 115, 0.10);
            border: 1px solid rgba(110, 110, 115, 0.18);
            padding: 4px 10px;
            border-radius: 999px;
        }

        /* PDF/print: avoid shadows bleeding across pages */
        @media print {
            .cover,
            .toc {
                box-shadow: none !important;
            }
        }
        
        h1 {
            font-size: 22pt;
            font-weight: 700;
            color: #007AFF;
            margin-top: 0;
            margin-bottom: 6px;
            page-break-after: avoid;
        }
        
        h2 {
            font-size: 14pt;
            font-weight: 600;
            color: #1D1D1F;
            margin-top: 18px;
            margin-bottom: 8px;
            padding-bottom: 4px;
            border-bottom: 1.5px solid #007AFF;
            page-break-after: avoid;
        }
        
        h3 {
            font-size: 11.5pt;
            font-weight: 600;
            color: #5856D6;
            margin-top: 14px;
            margin-bottom: 6px;
            page-break-after: avoid;
        }
        
        h4 {
            font-size: 10pt;
            font-weight: 600;
            color: #1D1D1F;
            margin-top: 12px;
            margin-bottom: 5px;
            page-break-after: avoid;
        }
        
        p {
            margin-bottom: 6px;
            text-align: justify;
        }
        
        strong {
            font-weight: 600;
        }
        
        /* Tables */
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 8px 0;
            font-size: 8.5pt;
            page-break-inside: avoid;
        }
        
        th {
            background: #007AFF;
            color: #FFFFFF;
            font-weight: 600;
            padding: 5px 8px;
            text-align: left;
            border: 1px solid #007AFF;
        }
        
        td {
            padding: 4px 8px;
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
            padding: 8px 12px;
            border-radius: 4px;
            overflow-x: auto;
            font-family: 'JetBrains Mono', 'Consolas', 'Monaco', monospace;
            font-size: 8pt;
            line-height: 1.4;
            margin: 8px 0;
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
            border-left: 3px solid #007AFF;
            padding: 10px 14px;
            margin: 10px 0;
            border-radius: 0 4px 4px 0;
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
            margin: 6px 0 8px 20px;
        }
        
        li {
            margin-bottom: 3px;
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
            top: '14mm',
            bottom: '14mm',
            left: '14mm',
            right: '14mm'
        },
        displayHeaderFooter: true,
        headerTemplate: `
            <div style="font-size: 8px; color: #86868B; width: 100%; text-align: center; padding: 10px 0; border-bottom: 0.5px solid #E5E5EA;">
                NDH AED Prediction Algorithm - Technical Documentation v${appVersion}
            </div>
        `,
        footerTemplate: `
            <div style="font-size: 8px; color: #86868B; width: 100%; padding: 8px 20px; display: flex; justify-content: space-between;">
                <span>North District Hospital</span>
                <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
                <span>${generatedAtHKT}</span>
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
