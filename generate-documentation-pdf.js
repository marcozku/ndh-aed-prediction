/**
 * NDH AED Prediction System - Professional Documentation Generator
 * Generates world-class Apple-style PDF documentation
 * 
 * @version 2.5.4
 * @date 2025-12-28
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Color scheme (Apple Style)
const colors = {
    primary: '#007AFF',
    primaryDark: '#0051D5',
    secondary: '#5856D6',
    success: '#34C759',
    warning: '#FF9500',
    danger: '#FF3B30',
    textPrimary: '#1D1D1F',
    textSecondary: '#86868B',
    textLight: '#F5F5F7',
    background: '#FFFFFF',
    cardBg: '#F5F5F7',
    border: '#E5E5EA',
    accent: '#AF52DE'
};

// Create PDF
const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 60, bottom: 60, left: 50, right: 50 },
    info: {
        Title: 'NDH AED Emergency Department Attendance Prediction System - Technical Documentation',
        Author: 'NDH AED Prediction Team',
        Subject: 'Algorithm Details and System Architecture',
        Keywords: 'AI, Prediction, Emergency Department, Machine Learning, XGBoost, Time Series'
    }
});

const outputPath = path.join(__dirname, 'NDH_AED_Technical_Documentation.pdf');
doc.pipe(fs.createWriteStream(outputPath));

let pageNumber = 0;

// Add header/footer
function addHeaderFooter() {
    pageNumber++;
    
    // Header line
    doc.save()
       .strokeColor(colors.border)
       .lineWidth(0.5)
       .moveTo(50, 45)
       .lineTo(545, 45)
       .stroke()
       .restore();
    
    // Footer
    doc.save()
       .fontSize(9)
       .fillColor(colors.textSecondary)
       .text('NDH AED Prediction System v2.5.4', 50, 780, { align: 'left' })
       .text('Page ' + pageNumber, 0, 780, { align: 'center', width: 595 })
       .text('North District Hospital', 0, 780, { align: 'right', width: 545 })
       .restore();
}

// Title Page
function createTitlePage() {
    doc.rect(0, 0, 595, 842).fill('#000000');
    
    // Gradient effect simulation
    for (let i = 0; i < 200; i++) {
        const opacity = 1 - (i / 200);
        doc.rect(0, 300 + i * 2, 595, 2)
           .fill(`rgba(0, 122, 255, ${opacity * 0.3})`);
    }
    
    // Main title
    doc.fontSize(42)
       .fillColor('#FFFFFF')
       .font('Helvetica-Bold')
       .text('NDH AED', 0, 200, { align: 'center' });
    
    doc.fontSize(24)
       .fillColor(colors.primary)
       .text('Emergency Department', 0, 260, { align: 'center' });
    
    doc.fontSize(24)
       .text('Attendance Prediction System', 0, 295, { align: 'center' });
    
    // Subtitle
    doc.fontSize(16)
       .fillColor('#FFFFFF')
       .font('Helvetica')
       .text('Technical Documentation & Algorithm Details', 0, 350, { align: 'center' });
    
    // Version info
    doc.fontSize(12)
       .fillColor(colors.textSecondary)
       .text('Version 2.5.4', 0, 420, { align: 'center' })
       .text('December 2025', 0, 440, { align: 'center' });
    
    // Key metrics
    const metrics = [
        { label: 'MAE Target', value: '< 2.5 patients' },
        { label: 'MAPE Target', value: '< 2.5%' },
        { label: '95% CI Coverage', value: '> 95%' }
    ];
    
    let yPos = 520;
    metrics.forEach(m => {
        doc.fontSize(11)
           .fillColor(colors.textSecondary)
           .text(m.label, 180, yPos)
           .fillColor('#FFFFFF')
           .font('Helvetica-Bold')
           .text(m.value, 350, yPos);
        yPos += 25;
    });
    
    // Bottom info
    doc.fontSize(10)
       .font('Helvetica')
       .fillColor(colors.textSecondary)
       .text('North District Hospital', 0, 700, { align: 'center' })
       .text('Hong Kong Hospital Authority', 0, 720, { align: 'center' });
}

// Table of Contents
function createTableOfContents() {
    doc.addPage();
    addHeaderFooter();
    
    doc.fontSize(28)
       .fillColor(colors.textPrimary)
       .font('Helvetica-Bold')
       .text('Table of Contents', 50, 80);
    
    doc.moveTo(50, 120).lineTo(250, 120).strokeColor(colors.primary).lineWidth(3).stroke();
    
    const toc = [
        { num: '1', title: 'System Overview', page: 3 },
        { num: '2', title: 'Prediction Algorithm Architecture', page: 4 },
        { num: '3', title: 'Core Mathematical Formulas', page: 6 },
        { num: '4', title: 'Feature Engineering', page: 9 },
        { num: '5', title: 'Machine Learning Models', page: 12 },
        { num: '6', title: 'Prediction Smoothing Methods', page: 14 },
        { num: '7', title: 'Weather Impact Factors', page: 17 },
        { num: '8', title: 'AI Real-time Analysis', page: 19 },
        { num: '9', title: 'Performance Metrics', page: 21 },
        { num: '10', title: 'System Architecture', page: 23 }
    ];
    
    let y = 150;
    toc.forEach(item => {
        doc.fontSize(14)
           .font('Helvetica-Bold')
           .fillColor(colors.primary)
           .text(item.num, 60, y)
           .font('Helvetica')
           .fillColor(colors.textPrimary)
           .text(item.title, 90, y);
        
        // Dotted line
        const dotStart = 320;
        const dotEnd = 500;
        for (let x = dotStart; x < dotEnd; x += 5) {
            doc.circle(x, y + 7, 0.5).fill(colors.textSecondary);
        }
        
        doc.fillColor(colors.textSecondary)
           .text(item.page.toString(), 510, y);
        
        y += 35;
    });
}

// Chapter 1: System Overview
function createChapter1() {
    doc.addPage();
    addHeaderFooter();
    
    // Chapter title
    doc.fontSize(32)
       .font('Helvetica-Bold')
       .fillColor(colors.primary)
       .text('1', 50, 80);
    
    doc.fontSize(24)
       .fillColor(colors.textPrimary)
       .text('System Overview', 80, 82);
    
    doc.moveTo(50, 125).lineTo(545, 125).strokeColor(colors.border).lineWidth(1).stroke();
    
    // Content
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor(colors.textPrimary);
    
    let y = 145;
    
    doc.text('The NDH AED Prediction System is a world-class emergency department attendance prediction platform designed specifically for North District Hospital in Hong Kong. The system combines advanced statistical models, machine learning algorithms, and real-time AI analysis to achieve exceptional prediction accuracy.', 50, y, { width: 495 });
    
    y += 70;
    
    doc.fontSize(14)
       .font('Helvetica-Bold')
       .text('System Objectives', 50, y);
    
    y += 25;
    doc.fontSize(10)
       .font('Helvetica');
    
    const objectives = [
        'Provide accurate daily attendance predictions',
        'Support 7-day and 30-day forecasting',
        'Integrate weather, holidays, flu season, and other factors',
        'Real-time AI analysis of news and events',
        'Provide confidence intervals and uncertainty estimates'
    ];
    
    objectives.forEach(obj => {
        doc.circle(60, y + 4, 2).fill(colors.primary);
        doc.fillColor(colors.textPrimary).text(obj, 70, y);
        y += 18;
    });
    
    y += 20;
    doc.fontSize(14)
       .font('Helvetica-Bold')
       .text('Data Foundation', 50, y);
    
    y += 25;
    
    const dataInfo = [
        ['Historical Data Range:', 'December 2014 - December 2025'],
        ['Total Records:', '3,431+ days of complete observations'],
        ['Attendance Range:', '111 - 394 patients/day'],
        ['Average Attendance:', '249.5 +/- 45.0 patients/day']
    ];
    
    dataInfo.forEach(info => {
        doc.fontSize(10)
           .font('Helvetica-Bold')
           .fillColor(colors.textSecondary)
           .text(info[0], 60, y)
           .font('Helvetica')
           .fillColor(colors.textPrimary)
           .text(info[1], 200, y);
        y += 18;
    });
    
    y += 20;
    doc.fontSize(14)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('Technical Highlights', 50, y);
    
    y += 25;
    
    const highlights = [
        'Multi-factor multiplicative prediction model',
        'Rolling window dynamic factor calculation (180 days)',
        'Exponential decay weighting mechanism',
        'Month-day-of-week interaction effects',
        'Real-time weather impact integration',
        'AI-driven event analysis',
        '9 prediction smoothing methods',
        'XGBoost machine learning enhancement'
    ];
    
    highlights.forEach((h, i) => {
        doc.fontSize(10)
           .font('Helvetica')
           .fillColor(colors.primary)
           .text((i + 1) + '.', 60, y)
           .fillColor(colors.textPrimary)
           .text(h, 80, y);
        y += 18;
    });
}

// Chapter 2: Prediction Algorithm Architecture
function createChapter2() {
    doc.addPage();
    addHeaderFooter();
    
    doc.fontSize(32)
       .font('Helvetica-Bold')
       .fillColor(colors.primary)
       .text('2', 50, 80);
    
    doc.fontSize(24)
       .fillColor(colors.textPrimary)
       .text('Prediction Algorithm Architecture', 80, 82);
    
    doc.moveTo(50, 125).lineTo(545, 125).strokeColor(colors.border).lineWidth(1).stroke();
    
    // Core formula box
    doc.roundedRect(50, 145, 495, 100, 8)
       .fillAndStroke(colors.cardBg, colors.border);
    
    doc.fontSize(12)
       .font('Helvetica-Bold')
       .fillColor(colors.primary)
       .text('Core Prediction Formula', 70, 160);
    
    doc.fontSize(10)
       .font('Helvetica')
       .fillColor(colors.textPrimary)
       .text('Final Prediction = Base Prediction + Lag Features Adj + Rolling Avg Adj + Trend Adj', 70, 185);
    
    doc.fontSize(9)
       .fillColor(colors.textSecondary)
       .text('Where: Base Prediction = Baseline x DOW Factor x Holiday Factor x Flu Season Factor', 70, 210)
       .text('                                      x Weather Factor x AI Factor', 70, 225);
    
    // Algorithm flow
    doc.fontSize(14)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('Algorithm Processing Flow', 50, 270);
    
    const steps = [
        { step: '1', title: 'Data Loading', desc: 'Fetch last 180 days of historical data from database' },
        { step: '2', title: 'Factor Calculation', desc: 'Calculate global mean, month factors, DOW factors with exponential decay' },
        { step: '3', title: 'Base Prediction', desc: 'Apply multiplicative model to compute base prediction' },
        { step: '4', title: 'Lag Adjustment', desc: 'Add Lag1, Lag7, and rolling average adjustments' },
        { step: '5', title: 'Trend Adjustment', desc: 'Calculate trend based on 7-day vs 30-day moving average' },
        { step: '6', title: 'Anomaly Detection', desc: 'Constrain prediction to reasonable range (150-350 patients)' },
        { step: '7', title: 'Confidence Intervals', desc: 'Calculate 80% and 95% confidence intervals' }
    ];
    
    let y = 300;
    steps.forEach(s => {
        // Step circle
        doc.circle(70, y + 10, 12)
           .fill(colors.primary);
        
        doc.fontSize(10)
           .font('Helvetica-Bold')
           .fillColor('#FFFFFF')
           .text(s.step, 66, y + 5);
        
        // Title and description
        doc.font('Helvetica-Bold')
           .fillColor(colors.textPrimary)
           .text(s.title, 95, y);
        
        doc.font('Helvetica')
           .fontSize(9)
           .fillColor(colors.textSecondary)
           .text(s.desc, 95, y + 15);
        
        // Connection line
        if (s.step !== '7') {
            doc.moveTo(70, y + 22).lineTo(70, y + 35)
               .strokeColor(colors.border).lineWidth(1).stroke();
        }
        
        y += 50;
    });
    
    // Research foundation
    doc.addPage();
    addHeaderFooter();
    
    doc.fontSize(18)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('Research Foundation', 50, 80);
    
    doc.moveTo(50, 105).lineTo(220, 105).strokeColor(colors.primary).lineWidth(2).stroke();
    
    const research = [
        {
            title: 'French Hospital XGBoost Study (2025)',
            journal: 'BMC Emergency Medicine',
            result: 'MAE: 2.63-2.64 patients',
            desc: 'ED admission prediction using ML and hyperparameter tuning'
        },
        {
            title: 'Feature Engineering Enhancement (2024)',
            journal: 'BMC Medical Informatics',
            result: '11 ED validation',
            desc: 'Calendar + meteorological predictors with feature engineering'
        },
        {
            title: 'LSTM Adaptive Framework (2024)',
            journal: 'PubMed',
            result: 'Outperforms ARIMA & Prophet',
            desc: 'Dynamic adaptation to data distribution changes without retraining'
        },
        {
            title: 'AI Framework for Crowding (2025)',
            journal: 'JMIR Medical Informatics',
            result: 'Real-time 6-hour prediction',
            desc: 'Multi-dataset integration for enhanced resource allocation'
        }
    ];
    
    y = 130;
    research.forEach(r => {
        doc.roundedRect(50, y, 495, 70, 5)
           .fillAndStroke(colors.cardBg, colors.border);
        
        doc.fontSize(11)
           .font('Helvetica-Bold')
           .fillColor(colors.textPrimary)
           .text(r.title, 65, y + 12);
        
        doc.fontSize(9)
           .font('Helvetica')
           .fillColor(colors.secondary)
           .text(r.journal, 65, y + 28);
        
        doc.fillColor(colors.success)
           .text(r.result, 350, y + 12, { width: 180 });
        
        doc.fillColor(colors.textSecondary)
           .text(r.desc, 65, y + 45, { width: 470 });
        
        y += 85;
    });
}

// Chapter 3: Core Mathematical Formulas
function createChapter3() {
    doc.addPage();
    addHeaderFooter();
    
    doc.fontSize(32)
       .font('Helvetica-Bold')
       .fillColor(colors.primary)
       .text('3', 50, 80);
    
    doc.fontSize(24)
       .fillColor(colors.textPrimary)
       .text('Core Mathematical Formulas', 80, 82);
    
    doc.moveTo(50, 125).lineTo(545, 125).strokeColor(colors.border).lineWidth(1).stroke();
    
    // 3.1 Weighted Average
    doc.fontSize(16)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('3.1 Exponential Decay Weighted Average', 50, 145);
    
    // Formula box
    doc.roundedRect(50, 170, 495, 90, 8)
       .fill('#1D1D1F');
    
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor('#00FF88')
       .text('Weight calculation:', 70, 185);
    
    doc.fillColor('#FFFFFF')
       .text('w_i = exp(-lambda * days_ago)', 220, 185);
    
    doc.fillColor('#00FF88')
       .text('Weighted mean:', 70, 210);
    
    doc.fillColor('#FFFFFF')
       .text('mu_weighted = SUM(attendance_i * w_i) / SUM(w_i)', 220, 210);
    
    doc.fillColor('#FFD60A')
       .fontSize(9)
       .text('lambda = 0.02 (decay rate), giving recent data higher weight', 70, 240);
    
    // 3.2 Month Factor
    doc.fontSize(16)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('3.2 Month Factor Calculation', 50, 285);
    
    doc.roundedRect(50, 310, 495, 60, 8)
       .fill('#1D1D1F');
    
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor('#FFFFFF')
       .text('monthFactor[m] = mu_weighted(month=m) / mu_global', 70, 335);
    
    doc.fillColor('#FFD60A')
       .fontSize(9)
       .text('Range: 0.85 - 1.25 (winter typically higher, summer lower)', 70, 355);
    
    // 3.3 Day of Week Factor
    doc.fontSize(16)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('3.3 Day-of-Week Factor Calculation', 50, 395);
    
    doc.roundedRect(50, 420, 495, 60, 8)
       .fill('#1D1D1F');
    
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor('#FFFFFF')
       .text('dowFactor[d] = mu_weighted(dow=d) / mu_global', 70, 445);
    
    doc.fillColor('#FFD60A')
       .fontSize(9)
       .text('Monday highest (~1.10), weekends lowest (~0.90)', 70, 465);
    
    // 3.4 Month-DOW Interaction
    doc.fontSize(16)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('3.4 Month-Day-of-Week Interaction Factor', 50, 505);
    
    doc.roundedRect(50, 530, 495, 60, 8)
       .fill('#1D1D1F');
    
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor('#FFFFFF')
       .text('monthDowFactor[m][d] = mu(month=m, dow=d) / (mu_global * monthFactor[m])', 70, 555);
    
    doc.fillColor('#FFD60A')
       .fontSize(9)
       .text('Based on research: DOW patterns vary across different months', 70, 575);
    
    // 3.5 Lag Features
    doc.addPage();
    addHeaderFooter();
    
    doc.fontSize(16)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('3.5 Lag Feature Adjustments', 50, 80);
    
    doc.roundedRect(50, 105, 495, 120, 8)
       .fill('#1D1D1F');
    
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor('#00FF88')
       .text('Lag1 adjustment:', 70, 125);
    doc.fillColor('#FFFFFF')
       .text('lag1_adj = (yesterday_attendance - mu_global) * 0.18', 200, 125);
    
    doc.fillColor('#00FF88')
       .text('Lag7 adjustment:', 70, 150);
    doc.fillColor('#FFFFFF')
       .text('lag7_adj = (same_day_last_week - mu_global) * 0.10', 200, 150);
    
    doc.fillColor('#00FF88')
       .text('Rolling adjustment:', 70, 175);
    doc.fillColor('#FFFFFF')
       .text('rolling_adj = (MA_7 - MA_30) * 0.14', 200, 175);
    
    doc.fillColor('#FFD60A')
       .fontSize(9)
       .text('Total adjustment = lag1_adj + lag7_adj + rolling_adj', 70, 205);
    
    // 3.6 Trend Adjustment
    doc.fontSize(16)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('3.6 Trend Adjustment (Prophet-inspired)', 50, 250);
    
    doc.roundedRect(50, 275, 495, 80, 8)
       .fill('#1D1D1F');
    
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor('#00FF88')
       .text('Trend:', 70, 295);
    doc.fillColor('#FFFFFF')
       .text('trend = (MA_7 - MA_30) / MA_30', 200, 295);
    
    doc.fillColor('#00FF88')
       .text('Trend adjustment:', 70, 320);
    doc.fillColor('#FFFFFF')
       .text('trend_adj = base_prediction * trend * 0.3', 200, 320);
    
    // 3.7 Confidence Intervals
    doc.fontSize(16)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('3.7 Confidence Interval Calculation', 50, 380);
    
    doc.roundedRect(50, 405, 495, 120, 8)
       .fill('#1D1D1F');
    
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor('#00FF88')
       .text('Adjusted std dev:', 70, 425);
    doc.fillColor('#FFFFFF')
       .text('sigma_adj = max(sigma_weighted * 1.2, 25)', 200, 425);
    
    doc.fillColor('#00FF88')
       .text('80% CI:', 70, 455);
    doc.fillColor('#FFFFFF')
       .text('[mu - 1.5 * sigma_adj, mu + 1.5 * sigma_adj]', 200, 455);
    
    doc.fillColor('#00FF88')
       .text('95% CI:', 70, 485);
    doc.fillColor('#FFFFFF')
       .text('[mu - 2.5 * sigma_adj, mu + 2.5 * sigma_adj]', 200, 485);
    
    doc.fillColor('#FFD60A')
       .fontSize(9)
       .text('Conservative multipliers (1.5, 2.5) ensure proper coverage', 70, 505);
}

// Chapter 4: Feature Engineering
function createChapter4() {
    doc.addPage();
    addHeaderFooter();
    
    doc.fontSize(32)
       .font('Helvetica-Bold')
       .fillColor(colors.primary)
       .text('4', 50, 80);
    
    doc.fontSize(24)
       .fillColor(colors.textPrimary)
       .text('Feature Engineering', 80, 82);
    
    doc.moveTo(50, 125).lineTo(545, 125).strokeColor(colors.border).lineWidth(1).stroke();
    
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor(colors.textPrimary)
       .text('The system uses 50+ engineered features for prediction. Major feature categories:', 50, 145);
    
    // Feature table
    const features = [
        { category: 'Temporal', features: 'Year, Month, Day_of_Week, Day_of_Month, Week_of_Year, Quarter' },
        { category: 'Cyclical Encoding', features: 'Month_sin, Month_cos, DayOfWeek_sin, DayOfWeek_cos' },
        { category: 'Lag Features', features: 'Lag1, Lag7, Lag14, Lag30, Lag60, Lag90, Lag365' },
        { category: 'Rolling Stats', features: 'Rolling7, Rolling14, Rolling30, Std7, Std14, Std30, Max/Min' },
        { category: 'Event Indicators', features: 'Is_COVID, Is_Omicron, Is_Winter_Flu, Is_Summer, Is_Weekend' },
        { category: 'Interactions', features: 'COVID_AND_Winter, Monday_AND_Winter, Weekend_AND_Summer' },
        { category: 'Trend Features', features: 'Days_Since_Start, Trend_Normalized, Era_Indicator' },
        { category: 'Rate of Change', features: 'Daily_Change, Weekly_Change, Monthly_Change' },
        { category: 'Holiday Features', features: 'Is_Holiday, Days_To_Next_Holiday' },
        { category: 'AI Factors', features: 'AI_Factor, Has_AI_Factor, AI_Factor_Type' }
    ];
    
    let y = 180;
    
    // Table header
    doc.roundedRect(50, y, 495, 25, 3)
       .fill(colors.primary);
    
    doc.fontSize(10)
       .font('Helvetica-Bold')
       .fillColor('#FFFFFF')
       .text('Category', 65, y + 8)
       .text('Features Included', 180, y + 8);
    
    y += 30;
    
    features.forEach((f, i) => {
        const bgColor = i % 2 === 0 ? '#FFFFFF' : colors.cardBg;
        doc.rect(50, y, 495, 35).fill(bgColor);
        
        doc.fontSize(9)
           .font('Helvetica-Bold')
           .fillColor(colors.textPrimary)
           .text(f.category, 65, y + 12);
        
        doc.font('Helvetica')
           .fontSize(8)
           .fillColor(colors.textSecondary)
           .text(f.features, 180, y + 8, { width: 350 });
        
        y += 35;
    });
    
    // Cyclical encoding explanation
    doc.addPage();
    addHeaderFooter();
    
    doc.fontSize(16)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('4.1 Cyclical Encoding Explained', 50, 80);
    
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor(colors.textPrimary)
       .text('Standard encoding fails to capture cyclical data continuity (December and January are far apart in standard encoding but are actually adjacent in time).', 50, 110, { width: 495 });
    
    doc.roundedRect(50, 150, 495, 100, 8)
       .fill('#1D1D1F');
    
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor('#00FF88')
       .text('Month cyclical encoding:', 70, 170);
    
    doc.fillColor('#FFFFFF')
       .text('Month_sin = sin(2 * pi * Month / 12)', 70, 195)
       .text('Month_cos = cos(2 * pi * Month / 12)', 70, 215);
    
    doc.fillColor('#FFD60A')
       .fontSize(9)
       .text('December and January now have similar encoding values, correctly reflecting proximity', 70, 240);
    
    // Feature importance
    doc.fontSize(16)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('4.2 Feature Importance Ranking (XGBoost)', 50, 280);
    
    const importance = [
        { rank: 1, feature: 'Attendance_Lag1', importance: 0.18 },
        { rank: 2, feature: 'Attendance_Rolling7', importance: 0.16 },
        { rank: 3, feature: 'Is_COVID_Period', importance: 0.14 },
        { rank: 4, feature: 'Is_Winter_Flu_Season', importance: 0.12 },
        { rank: 5, feature: 'Is_Monday', importance: 0.10 },
        { rank: 6, feature: 'Month_sin', importance: 0.09 },
        { rank: 7, feature: 'Attendance_Lag365', importance: 0.08 },
        { rank: 8, feature: 'Is_Weekend', importance: 0.07 }
    ];
    
    y = 310;
    importance.forEach(item => {
        const barWidth = item.importance * 1500;
        
        doc.fontSize(9)
           .font('Helvetica')
           .fillColor(colors.textSecondary)
           .text(item.rank.toString(), 55, y + 2)
           .fillColor(colors.textPrimary)
           .text(item.feature, 75, y + 2);
        
        doc.roundedRect(240, y, barWidth, 15, 3)
           .fill(colors.primary);
        
        doc.fontSize(8)
           .fillColor(colors.textSecondary)
           .text((item.importance * 100).toFixed(0) + '%', 250 + barWidth, y + 3);
        
        y += 25;
    });
    
    doc.fontSize(9)
       .fillColor(colors.textSecondary)
       .text('Top 5 features explain ~70% of model variance', 50, y + 10);
}

// Chapter 5: Machine Learning Models
function createChapter5() {
    doc.addPage();
    addHeaderFooter();
    
    doc.fontSize(32)
       .font('Helvetica-Bold')
       .fillColor(colors.primary)
       .text('5', 50, 80);
    
    doc.fontSize(24)
       .fillColor(colors.textPrimary)
       .text('Machine Learning Models', 80, 82);
    
    doc.moveTo(50, 125).lineTo(545, 125).strokeColor(colors.border).lineWidth(1).stroke();
    
    // XGBoost
    doc.fontSize(18)
       .font('Helvetica-Bold')
       .fillColor(colors.secondary)
       .text('5.1 XGBoost Gradient Boosting Trees', 50, 145);
    
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor(colors.textPrimary)
       .text('XGBoost is the core ML model, based on French hospital research achieving world-best MAE.', 50, 175, { width: 495 });
    
    // Parameter table
    const params = [
        { param: 'n_estimators', value: '500', desc: 'Number of trees' },
        { param: 'max_depth', value: '6', desc: 'Maximum depth' },
        { param: 'learning_rate', value: '0.05', desc: 'Learning rate' },
        { param: 'subsample', value: '0.8', desc: 'Sample ratio' },
        { param: 'colsample_bytree', value: '0.8', desc: 'Feature ratio' },
        { param: 'alpha (L1)', value: '1.0', desc: 'L1 regularization' },
        { param: 'lambda (L2)', value: '1.0', desc: 'L2 regularization' },
        { param: 'early_stopping', value: '50', desc: 'Early stopping rounds' }
    ];
    
    let y = 210;
    
    doc.roundedRect(50, y, 495, 25, 3)
       .fill(colors.primary);
    
    doc.fontSize(9)
       .font('Helvetica-Bold')
       .fillColor('#FFFFFF')
       .text('Parameter', 65, y + 8)
       .text('Value', 200, y + 8)
       .text('Description', 320, y + 8);
    
    y += 28;
    
    params.forEach((p, i) => {
        const bgColor = i % 2 === 0 ? '#FFFFFF' : colors.cardBg;
        doc.rect(50, y, 495, 22).fill(bgColor);
        
        doc.fontSize(9)
           .font('Helvetica')
           .fillColor(colors.textPrimary)
           .text(p.param, 65, y + 6)
           .fillColor(colors.primary)
           .font('Helvetica-Bold')
           .text(p.value, 200, y + 6)
           .font('Helvetica')
           .fillColor(colors.textSecondary)
           .text(p.desc, 320, y + 6);
        
        y += 22;
    });
    
    // Training flow
    doc.fontSize(16)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('5.2 Training Pipeline', 50, y + 30);
    
    y += 55;
    
    const steps = [
        'Load historical data from database',
        'Feature engineering (50+ features)',
        'Time series split (80% train, 20% test)',
        'Model training (gradient boosting)',
        'Early stopping validation',
        'Performance evaluation (MAE, RMSE, MAPE)',
        'Model serialization'
    ];
    
    steps.forEach((step, i) => {
        doc.circle(70, y + 8, 8)
           .fill(colors.success);
        
        doc.fontSize(8)
           .font('Helvetica-Bold')
           .fillColor('#FFFFFF')
           .text((i + 1).toString(), 67, y + 4);
        
        doc.fontSize(10)
           .font('Helvetica')
           .fillColor(colors.textPrimary)
           .text(step, 90, y + 3);
        
        y += 25;
    });
}

// Chapter 6: Prediction Smoothing Methods
function createChapter6() {
    doc.addPage();
    addHeaderFooter();
    
    doc.fontSize(32)
       .font('Helvetica-Bold')
       .fillColor(colors.primary)
       .text('6', 50, 80);
    
    doc.fontSize(24)
       .fillColor(colors.textPrimary)
       .text('Prediction Smoothing Methods', 80, 82);
    
    doc.moveTo(50, 125).lineTo(545, 125).strokeColor(colors.border).lineWidth(1).stroke();
    
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor(colors.textPrimary)
       .text('The system makes 48 predictions daily (every 30 minutes), using 9 smoothing methods to derive the final prediction.', 50, 145, { width: 495 });
    
    const methods = [
        {
            name: '1. Simple Moving Average',
            formula: 'SMA = SUM(predictions) / n',
            desc: 'Arithmetic mean of all 48 predictions (baseline method)'
        },
        {
            name: '2. Exponentially Weighted MA (EWMA)',
            formula: 'S_t = alpha * P_t + (1-alpha) * S_{t-1}',
            desc: 'alpha = 0.65, later predictions weighted higher'
        },
        {
            name: '3. Confidence Weighted Average',
            formula: 'W_avg = SUM(P_i * conf_i) / SUM(conf_i)',
            desc: 'Weighted by prediction confidence scores'
        },
        {
            name: '4. Time-Window Weighted Ensemble',
            formula: 'W_i = 1 / MAE_timeSlot',
            desc: 'Weight by historical accuracy for each time slot'
        },
        {
            name: '5. Trimmed Mean',
            formula: 'TM = mean(sorted[10%:90%])',
            desc: 'Remove top and bottom 10% outlier predictions'
        },
        {
            name: '6. Variance-Based Filtering',
            formula: 'filter: |P - median| <= 1.5 * sigma',
            desc: 'Exclude outliers beyond 1.5 std dev, then apply EWMA'
        },
        {
            name: '7. Kalman Filter Smoothing',
            formula: 'K = P_pred / (P_pred + R)',
            desc: 'Recursive optimal state estimation, Q=1.0, R=10.0'
        },
        {
            name: '8. Ensemble Meta-Method (Recommended)',
            formula: 'EM = 0.30*EWMA + 0.25*TW + 0.20*TM + 0.25*KF',
            desc: 'Weighted combination of multiple methods'
        },
        {
            name: '9. Stability Analysis',
            formula: 'CV = sigma / mu',
            desc: 'Coefficient of variation as quality metric'
        }
    ];
    
    let y = 175;
    
    methods.forEach((m, i) => {
        if (y > 700) {
            doc.addPage();
            addHeaderFooter();
            y = 80;
        }
        
        doc.roundedRect(50, y, 495, 65, 5)
           .fillAndStroke(i === 7 ? '#E8F5E9' : colors.cardBg, colors.border);
        
        doc.fontSize(10)
           .font('Helvetica-Bold')
           .fillColor(i === 7 ? colors.success : colors.textPrimary)
           .text(m.name, 65, y + 10);
        
        doc.fontSize(9)
           .font('Helvetica')
           .fillColor(colors.secondary)
           .text(m.formula, 65, y + 28);
        
        doc.fillColor(colors.textSecondary)
           .text(m.desc, 65, y + 45, { width: 465 });
        
        y += 75;
    });
    
    // Auto selection strategy
    doc.addPage();
    addHeaderFooter();
    
    doc.fontSize(16)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('6.2 Automatic Selection Strategy', 50, 80);
    
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor(colors.textPrimary)
       .text('The system automatically selects the best smoothing method based on prediction stability (Coefficient of Variation):', 50, 110, { width: 495 });
    
    const strategies = [
        { cv: 'CV < 5%', level: 'High Stability', method: 'Simple Average', color: colors.success },
        { cv: '5% <= CV <= 15%', level: 'Medium Stability', method: 'Ensemble Meta-Method', color: colors.warning },
        { cv: 'CV > 15%', level: 'Low Stability', method: 'Variance Filtering', color: colors.danger }
    ];
    
    y = 150;
    strategies.forEach(s => {
        doc.roundedRect(50, y, 495, 50, 5)
           .fillAndStroke('#FFFFFF', s.color);
        
        doc.circle(75, y + 25, 15)
           .fill(s.color);
        
        doc.fontSize(10)
           .font('Helvetica-Bold')
           .fillColor(colors.textPrimary)
           .text(s.cv, 110, y + 12)
           .text(s.level, 260, y + 12)
           .fillColor(s.color)
           .text(s.method, 400, y + 12);
        
        y += 60;
    });
}

// Chapter 7: Weather Impact
function createChapter7() {
    doc.addPage();
    addHeaderFooter();
    
    doc.fontSize(32)
       .font('Helvetica-Bold')
       .fillColor(colors.primary)
       .text('7', 50, 80);
    
    doc.fontSize(24)
       .fillColor(colors.textPrimary)
       .text('Weather Impact Factors', 80, 82);
    
    doc.moveTo(50, 125).lineTo(545, 125).strokeColor(colors.border).lineWidth(1).stroke();
    
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor(colors.textPrimary)
       .text('Weather significantly impacts ED attendance. The system uses relative temperature (compared to historical average) rather than absolute temperature, based on research findings.', 50, 145, { width: 495 });
    
    // Temperature impact
    doc.fontSize(16)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('7.1 Temperature Impact', 50, 195);
    
    const tempEffects = [
        { condition: '> 5C above historical average', factor: 'x1.06', effect: '+6%' },
        { condition: '> 5C below historical average', factor: 'x1.10', effect: '+10%' },
        { condition: 'Absolute temp > 33C', factor: 'x1.08', effect: 'Extreme heat' },
        { condition: 'Absolute temp 30-33C', factor: 'x1.04', effect: 'Hot' },
        { condition: 'Absolute temp 10-15C', factor: 'x1.06', effect: 'Cold' },
        { condition: 'Absolute temp < 10C', factor: 'x1.12', effect: 'Severe cold' }
    ];
    
    let y = 220;
    tempEffects.forEach((t, i) => {
        const bgColor = i % 2 === 0 ? '#FFFFFF' : colors.cardBg;
        doc.rect(50, y, 495, 25).fill(bgColor);
        
        doc.fontSize(9)
           .font('Helvetica')
           .fillColor(colors.textPrimary)
           .text(t.condition, 65, y + 8)
           .fillColor(colors.danger)
           .font('Helvetica-Bold')
           .text(t.factor, 320, y + 8)
           .font('Helvetica')
           .fillColor(colors.textSecondary)
           .text(t.effect, 420, y + 8);
        
        y += 25;
    });
    
    // Other weather factors
    doc.fontSize(16)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('7.2 Other Weather Factors', 50, y + 30);
    
    y += 55;
    
    const otherFactors = [
        { category: 'Humidity', factors: ['>=95%: x1.03', '85-95%: x1.01', '<60%: x0.99'] },
        { category: 'Rainfall', factors: ['>=30mm: x0.92', '10-30mm: x0.96', '<10mm: x0.98'] },
        { category: 'Warnings', factors: ['T8 Typhoon: x0.40', 'Red Rain: x0.75', 'Cold Warning: x1.08'] }
    ];
    
    otherFactors.forEach(o => {
        doc.fontSize(11)
           .font('Helvetica-Bold')
           .fillColor(colors.secondary)
           .text(o.category, 50, y);
        
        y += 20;
        o.factors.forEach(f => {
            doc.fontSize(9)
               .font('Helvetica')
               .fillColor(colors.textPrimary)
               .text('  - ' + f, 70, y);
            y += 15;
        });
        y += 10;
    });
    
    // Weather factor formula
    doc.roundedRect(50, y, 495, 50, 8)
       .fill('#1D1D1F');
    
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor('#00FF88')
       .text('Weather Factor:', 70, y + 15);
    
    doc.fillColor('#FFFFFF')
       .text('weatherFactor = tempFactor * humidityFactor * rainFactor * warningFactor', 180, y + 15);
    
    doc.fillColor('#FFD60A')
       .fontSize(9)
       .text('Range: 0.40 - 1.15', 70, y + 35);
}

// Chapter 8: AI Real-time Analysis
function createChapter8() {
    doc.addPage();
    addHeaderFooter();
    
    doc.fontSize(32)
       .font('Helvetica-Bold')
       .fillColor(colors.primary)
       .text('8', 50, 80);
    
    doc.fontSize(24)
       .fillColor(colors.textPrimary)
       .text('AI Real-time Analysis', 80, 82);
    
    doc.moveTo(50, 125).lineTo(545, 125).strokeColor(colors.border).lineWidth(1).stroke();
    
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor(colors.textPrimary)
       .text('The system integrates AI large language models for real-time news and event analysis, automatically identifying factors that may impact ED attendance.', 50, 145, { width: 495 });
    
    // AI Models
    doc.fontSize(16)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('8.1 AI Model Selection', 50, 185);
    
    const models = [
        { tier: 'Premium Models', models: 'GPT-5.1, GPT-5, GPT-4o, GPT-4.1', limit: '5/day' },
        { tier: 'Standard Models', models: 'DeepSeek-R1, DeepSeek-V3', limit: '30/day' },
        { tier: 'Basic Models', models: 'GPT-4o-mini, GPT-3.5-turbo', limit: '200/day' }
    ];
    
    let y = 210;
    models.forEach((m, i) => {
        doc.roundedRect(50, y, 495, 35, 5)
           .fillAndStroke(colors.cardBg, colors.border);
        
        doc.fontSize(10)
           .font('Helvetica-Bold')
           .fillColor(colors.primary)
           .text(m.tier, 65, y + 12);
        
        doc.font('Helvetica')
           .fillColor(colors.textPrimary)
           .text(m.models, 180, y + 12);
        
        doc.fillColor(colors.success)
           .text(m.limit, 450, y + 12);
        
        y += 45;
    });
    
    // Analysis scope
    doc.fontSize(16)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('8.2 Analysis Scope', 50, y + 20);
    
    y += 50;
    
    const categories = [
        { icon: 'W', name: 'Weather Events', examples: 'Extreme weather, typhoons, rainstorms' },
        { icon: 'H', name: 'Public Health', examples: 'Flu outbreaks, food poisoning, infectious diseases' },
        { icon: 'S', name: 'Social Events', examples: 'Large gatherings, traffic accidents, demonstrations' },
        { icon: 'C', name: 'Calendar Effects', examples: 'Public holidays, school breaks, special occasions' },
        { icon: 'P', name: 'Policy Changes', examples: 'Fee adjustments, triage policies, service changes' }
    ];
    
    categories.forEach(c => {
        doc.circle(70, y + 5, 10)
           .fill(colors.primary);
        
        doc.fontSize(9)
           .font('Helvetica-Bold')
           .fillColor('#FFFFFF')
           .text(c.icon, 66, y + 1);
        
        doc.fontSize(10)
           .font('Helvetica-Bold')
           .fillColor(colors.textPrimary)
           .text(c.name, 95, y);
        
        doc.fontSize(9)
           .font('Helvetica')
           .fillColor(colors.textSecondary)
           .text(c.examples, 220, y);
        
        y += 28;
    });
    
    // AI factor limit
    doc.fontSize(16)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('8.3 AI Factor Constraints', 50, y + 20);
    
    doc.roundedRect(50, y + 50, 495, 60, 8)
       .fill('#1D1D1F');
    
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor('#00FF88')
       .text('AI Factor Range:', 70, y + 70);
    
    doc.fillColor('#FFFFFF')
       .text('aiFactor = max(0.85, min(1.15, rawAIFactor))', 200, y + 70);
    
    doc.fillColor('#FFD60A')
       .fontSize(9)
       .text('Limited to +/-15% to prevent single factor from dominating prediction', 70, y + 95);
}

// Chapter 9: Performance Metrics
function createChapter9() {
    doc.addPage();
    addHeaderFooter();
    
    doc.fontSize(32)
       .font('Helvetica-Bold')
       .fillColor(colors.primary)
       .text('9', 50, 80);
    
    doc.fontSize(24)
       .fillColor(colors.textPrimary)
       .text('Performance Metrics', 80, 82);
    
    doc.moveTo(50, 125).lineTo(545, 125).strokeColor(colors.border).lineWidth(1).stroke();
    
    // Target metrics
    doc.fontSize(16)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('9.1 Target Performance Metrics', 50, 145);
    
    const targets = [
        { metric: 'MAE', target: '< 2.5 patients', worldBest: '2.63-2.64', status: 'In Progress' },
        { metric: 'MAPE', target: '< 2.5%', worldBest: '~2-3%', status: 'In Progress' },
        { metric: 'Directional Accuracy', target: '> 93%', worldBest: '~91%', status: 'In Progress' },
        { metric: '80% CI Coverage', target: '> 80%', worldBest: '~85%', status: 'In Progress' },
        { metric: '95% CI Coverage', target: '> 95%', worldBest: '~95%', status: 'In Progress' },
        { metric: 'R-squared', target: '> 0.97', worldBest: '~0.95', status: 'Planned' }
    ];
    
    let y = 175;
    
    doc.roundedRect(50, y, 495, 25, 3)
       .fill(colors.primary);
    
    doc.fontSize(9)
       .font('Helvetica-Bold')
       .fillColor('#FFFFFF')
       .text('Metric', 65, y + 8)
       .text('Target', 170, y + 8)
       .text('World Best', 290, y + 8)
       .text('Status', 420, y + 8);
    
    y += 28;
    
    targets.forEach((t, i) => {
        const bgColor = i % 2 === 0 ? '#FFFFFF' : colors.cardBg;
        doc.rect(50, y, 495, 25).fill(bgColor);
        
        doc.fontSize(9)
           .font('Helvetica-Bold')
           .fillColor(colors.textPrimary)
           .text(t.metric, 65, y + 8);
        
        doc.font('Helvetica')
           .fillColor(colors.success)
           .text(t.target, 170, y + 8);
        
        doc.fillColor(colors.textSecondary)
           .text(t.worldBest, 290, y + 8);
        
        doc.fillColor(colors.textPrimary)
           .text(t.status, 420, y + 8);
        
        y += 25;
    });
    
    // Evaluation formulas
    doc.fontSize(16)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('9.2 Evaluation Metric Formulas', 50, y + 30);
    
    y += 55;
    
    const formulas = [
        { name: 'MAE', formula: 'MAE = (1/n) * SUM(|y_i - y_hat_i|)' },
        { name: 'MAPE', formula: 'MAPE = (100/n) * SUM(|y_i - y_hat_i| / y_i)' },
        { name: 'RMSE', formula: 'RMSE = sqrt[(1/n) * SUM((y_i - y_hat_i)^2)]' },
        { name: 'R-squared', formula: 'R^2 = 1 - SS_res / SS_tot' }
    ];
    
    formulas.forEach(f => {
        doc.roundedRect(50, y, 495, 35, 5)
           .fill('#1D1D1F');
        
        doc.fontSize(10)
           .font('Helvetica-Bold')
           .fillColor(colors.primary)
           .text(f.name, 70, y + 12);
        
        doc.font('Helvetica')
           .fillColor('#FFFFFF')
           .text(f.formula, 150, y + 12);
        
        y += 45;
    });
}

// Chapter 10: System Architecture
function createChapter10() {
    doc.addPage();
    addHeaderFooter();
    
    doc.fontSize(32)
       .font('Helvetica-Bold')
       .fillColor(colors.primary)
       .text('10', 50, 80);
    
    doc.fontSize(24)
       .fillColor(colors.textPrimary)
       .text('System Architecture', 95, 82);
    
    doc.moveTo(50, 125).lineTo(545, 125).strokeColor(colors.border).lineWidth(1).stroke();
    
    // Architecture diagram
    const components = [
        { x: 250, y: 180, w: 120, h: 50, label: 'User Interface', color: colors.primary, desc: 'HTML/CSS/JS' },
        { x: 250, y: 280, w: 120, h: 50, label: 'Node.js Server', color: colors.secondary, desc: 'Express API' },
        { x: 100, y: 380, w: 100, h: 50, label: 'PostgreSQL', color: colors.success, desc: 'Database' },
        { x: 250, y: 380, w: 100, h: 50, label: 'Python ML', color: colors.warning, desc: 'XGBoost' },
        { x: 400, y: 380, w: 100, h: 50, label: 'AI API', color: colors.danger, desc: 'GPT/DeepSeek' }
    ];
    
    components.forEach(c => {
        doc.roundedRect(c.x, c.y, c.w, c.h, 8)
           .fillAndStroke(c.color, c.color);
        
        doc.fontSize(10)
           .font('Helvetica-Bold')
           .fillColor('#FFFFFF')
           .text(c.label, c.x, c.y + 15, { width: c.w, align: 'center' });
        
        doc.fontSize(8)
           .font('Helvetica')
           .text(c.desc, c.x, c.y + 32, { width: c.w, align: 'center' });
    });
    
    // Connection lines
    doc.strokeColor(colors.textSecondary).lineWidth(2);
    doc.moveTo(310, 230).lineTo(310, 280).stroke();
    doc.moveTo(150, 330).lineTo(310, 330).lineTo(310, 380).stroke();
    doc.moveTo(310, 330).lineTo(300, 380).stroke();
    doc.moveTo(310, 330).lineTo(450, 330).lineTo(450, 380).stroke();
    
    // Data flow description
    doc.fontSize(14)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('Data Flow', 50, 480);
    
    const flow = [
        '1. User accesses web page, triggers prediction request',
        '2. Node.js server receives request',
        '3. Fetch historical data from PostgreSQL',
        '4. Call Python XGBoost model (if available)',
        '5. Call AI API for real-time event analysis',
        '6. Combine all factors to calculate final prediction',
        '7. Return prediction result with confidence intervals'
    ];
    
    let y = 510;
    flow.forEach(f => {
        doc.fontSize(10)
           .font('Helvetica')
           .fillColor(colors.textPrimary)
           .text(f, 65, y);
        y += 20;
    });
    
    // Tech stack
    doc.fontSize(14)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('Technology Stack', 50, y + 20);
    
    const techStack = [
        { category: 'Frontend', tech: 'HTML5, CSS3, JavaScript (ES6+), Chart.js' },
        { category: 'Backend', tech: 'Node.js 18+, Express' },
        { category: 'Database', tech: 'PostgreSQL 15+' },
        { category: 'ML', tech: 'Python 3, XGBoost, NumPy, Pandas' },
        { category: 'AI', tech: 'OpenAI GPT, DeepSeek' },
        { category: 'Deployment', tech: 'Railway, Docker' }
    ];
    
    y += 45;
    techStack.forEach(t => {
        doc.fontSize(9)
           .font('Helvetica-Bold')
           .fillColor(colors.primary)
           .text(t.category + ':', 65, y);
        
        doc.font('Helvetica')
           .fillColor(colors.textSecondary)
           .text(t.tech, 140, y);
        
        y += 18;
    });
}

// Conclusion
function createConclusion() {
    doc.addPage();
    addHeaderFooter();
    
    doc.fontSize(28)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('Conclusion', 50, 80);
    
    doc.moveTo(50, 115).lineTo(180, 115).strokeColor(colors.primary).lineWidth(3).stroke();
    
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor(colors.textPrimary);
    
    let y = 140;
    
    doc.text('The NDH AED Prediction System is a world-class prediction platform that combines statistics, machine learning, and artificial intelligence. By integrating multiple advanced techniques and methods, the system delivers highly accurate emergency department attendance predictions, helping hospital management with effective resource planning and staff allocation.', 50, y, { width: 495 });
    
    y += 80;
    
    doc.fontSize(14)
       .font('Helvetica-Bold')
       .text('Core Advantages', 50, y);
    
    y += 25;
    
    const advantages = [
        'Multi-factor multiplicative model - considers time, weather, holidays, AI factors',
        'Dynamic factor calculation - rolling window with exponential decay weights',
        'Machine learning enhancement - XGBoost captures complex nonlinear patterns',
        'Real-time AI analysis - automatically identifies and quantifies news events',
        'Multiple smoothing methods - 9 techniques for robust final predictions',
        'Uncertainty quantification - confidence intervals to support decision-making'
    ];
    
    advantages.forEach(a => {
        doc.fontSize(10)
           .font('Helvetica')
           .fillColor(colors.textPrimary);
        doc.circle(60, y + 4, 2).fill(colors.success);
        doc.text(a, 70, y, { width: 475 });
        y += 25;
    });
    
    y += 15;
    
    doc.fontSize(14)
       .font('Helvetica-Bold')
       .fillColor(colors.textPrimary)
       .text('Future Development', 50, y);
    
    y += 25;
    
    const future = [
        'Integrate more external data sources (flu surveillance, air quality)',
        'Multi-horizon prediction (1-6 hours, 1-7 days, 1-4 weeks)',
        'Develop admitted patient prediction functionality',
        'Continuous algorithm optimization to achieve world-best accuracy',
        'Publish academic papers for international recognition'
    ];
    
    future.forEach((f, i) => {
        doc.fontSize(10)
           .font('Helvetica')
           .fillColor(colors.textPrimary)
           .text((i + 1) + '. ' + f, 60, y);
        y += 20;
    });
    
    y += 30;
    
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor(colors.textSecondary)
       .text('We are committed to making the NDH AED Prediction System the most accurate and reliable emergency department attendance prediction tool in the world.', 50, y, { width: 495 });
    
    // Contact info
    doc.fontSize(12)
       .font('Helvetica-Bold')
       .fillColor(colors.primary)
       .text('North District Hospital', 50, 680);
    
    doc.fontSize(10)
       .font('Helvetica')
       .fillColor(colors.textSecondary)
       .text('Hospital Authority, Hong Kong', 50, 700)
       .text('Version 2.5.4 | December 2025', 50, 715);
}

// Generate PDF
console.log('Generating PDF documentation...');

createTitlePage();
createTableOfContents();
createChapter1();
createChapter2();
createChapter3();
createChapter4();
createChapter5();
createChapter6();
createChapter7();
createChapter8();
createChapter9();
createChapter10();
createConclusion();

doc.end();

console.log('PDF generated: ' + outputPath);
console.log('Total pages: ' + (pageNumber + 1));
