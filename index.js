const express = require('express');
const Datastore = require('nedb-promises');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Initialize the local database file
const db = Datastore.create({ filename: 'history.db', autoload: true });

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// 1. Home Page: DTI Calculator & History Log
app.get('/', async (req, res) => {
    try {
        const history = await db.find({}).sort({ timestamp: -1 }).limit(5);

        let historyHTML = '';
        if (history.length === 0) {
            historyHTML = '<p style="color: #7f8c8d; font-style: italic;">No calculations saved yet.</p>';
        } else {
            historyHTML = '<ul style="list-style: none; padding: 0; margin: 0 0 20px 0;">';
            history.forEach(item => {
                historyHTML += `
                    <li style="padding: 12px 0; border-bottom: 1px solid #ecf0f1; font-size: 14px; display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: #2c3e50;">Debt: $${item.debt} | Income: $${item.income}</span>
                        <strong style="color: #2980b9; background: #e8f4fd; padding: 4px 8px; border-radius: 4px;">${item.ratio}%</strong>
                    </li>
                `;
            });
            historyHTML += '</ul>';
            
            historyHTML += `
                <form action="/clear" method="POST">
                    <button type="submit" class="clear-btn">Clear History</button>
                </form>
            `;
        }

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Debt-Relief Platform</title>
                <link rel="stylesheet" href="/style.css">
            </head>
            <body>
                <div class="container">
                    <h2>DTI Calculator</h2>
                    <form action="/calculate" method="POST">
                        <label for="debt">Total Monthly Debt ($):</label>
                        <input type="number" id="debt" name="debt" placeholder="e.g., 1200" required>

                        <label for="income">Gross Monthly Income ($):</label>
                        <input type="number" id="income" name="income" placeholder="e.g., 4000" required>

                        <button type="submit">Calculate and Save</button>
                    </form>
                    <!-- NEW: Navigation to the second tool -->
                    <p style="text-align: center; margin-top: 20px;">
                        <a href="/payoff" style="color: #3498db; font-weight: bold; text-decoration: none;">Try the Payoff Estimator →</a>
                    </p>
                </div>

                <div class="container">
                    <h2>Recent Calculations</h2>
                    ${historyHTML}
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send("Error reading from database.");
    }
});

// 2. DTI Calculation Route
app.post('/calculate', async (req, res) => {
    const totalDebt = parseFloat(req.body.debt);
    const monthlyIncome = parseFloat(req.body.income);

    if (isNaN(totalDebt) || isNaN(monthlyIncome) || monthlyIncome === 0) {
        return res.send('Please provide valid numbers. <br><a href="/">Go Back</a>');
    }

    const dtiRatio = ((totalDebt / monthlyIncome) * 100).toFixed(1);

    try {
        await db.insert({
            debt: totalDebt,
            income: monthlyIncome,
            ratio: dtiRatio,
            timestamp: new Date()
        });
    } catch (err) {
        console.error("Failed to save to database", err);
    }

    let advice = "";
    let alertColor = "#2ecc71";

    if (dtiRatio <= 36) {
        advice = "Your debt level is healthy! (Under 36%)";
    } else if (dtiRatio <= 49) {
        advice = "Your debt is manageable, but you are approaching risky levels. (37% - 49%)";
        alertColor = "#f1c40f";
    } else {
        advice = "Alert: Your debt is high. You might need relief assistance. (50%+)";
        alertColor = "#e74c3c";
    }

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Calculation Results</title>
            <link rel="stylesheet" href="/style.css">
            <style>
                body { display: flex; justify-content: center; align-items: center; }
                .result { font-size: 42px; font-weight: bold; color: ${alertColor}; margin: 20px 0; }
                a { display: inline-block; margin-top: 20px; text-decoration: none; color: #3498db; font-weight: bold; }
                a:hover { text-decoration: underline; }
            </style>
        </head>
        <body>
            <div class="container" style="text-align: center;">
                <h2>Your DTI Results</h2>
                <div class="result">${dtiRatio}%</div>
                <p style="color: #34495e; font-size: 16px; line-height: 1.5;"><strong>Status:</strong> ${advice}</p>
                <a href="/">← Go back & see history</a>
            </div>
        </body>
        </html>
    `);
});

// NEW: 3. Payoff Estimator Form Page
app.get('/payoff', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Debt Payoff Estimator</title>
            <link rel="stylesheet" href="/style.css">
        </head>
        <body>
            <div class="container">
                <h2>Payoff Estimator</h2>
                <form action="/payoff" method="POST">
                    <label for="balance">Total Debt Balance ($):</label>
                    <input type="number" id="balance" name="balance" placeholder="e.g., 10000" required>

                    <label for="rate">Annual Interest Rate (%):</label>
                    <input type="number" id="rate" name="rate" step="0.1" placeholder="e.g., 15" required>

                    <label for="payment">Monthly Payment ($):</label>
                    <input type="number" id="payment" name="payment" placeholder="e.g., 350" required>

                    <button type="submit">Estimate Payoff Time</button>
                </form>
                <p style="text-align: center; margin-top: 20px;">
                    <a href="/" style="color: #7f8c8d; text-decoration: none;">← Back to DTI Calculator</a>
                </p>
            </div>
        </body>
        </html>
    `);
});

// NEW: 4. Payoff Math Calculation Route
app.post('/payoff', (req, res) => {
    let balance = parseFloat(req.body.balance);
    const annualRate = parseFloat(req.body.rate) / 100;
    const monthlyPayment = parseFloat(req.body.payment);

    const monthlyRate = annualRate / 12;
    let months = 0;
    let totalInterestPaid = 0;
    const originalBalance = balance;

    // Safety Check: If the monthly payment doesn't even cover the interest, it can never be paid off
    if (balance * monthlyRate >= monthlyPayment) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <link rel="stylesheet" href="/style.css">
            </head>
            <body>
                <div class="container" style="text-align: center; border-top: 5px solid #e74c3c;">
                    <h2>Calculation Alert</h2>
                    <p style="color: #e74c3c; font-weight: bold; margin: 20px 0;">
                        Your monthly payment ($${monthlyPayment}) is too low!
                    </p>
                    <p style="font-size: 14px; color: #7f8c8d; line-height: 1.5;">
                        It doesn't even cover your initial monthly interest of $${(balance * monthlyRate).toFixed(2)}. 
                        Your debt would grow forever. Please increase your monthly payment.
                    </p>
                    <a href="/payoff" style="display: inline-block; margin-top: 20px; text-decoration: none; color: #3498db; font-weight: bold;">← Try Again</a>
                </div>
            </body>
            </html>
        `);
    }

    // Amortization Loop
    while (balance > 0) {
        const monthlyInterest = balance * monthlyRate;
        totalInterestPaid += monthlyInterest;
        
        // If the remaining balance + interest is less than the payment, pay it off fully
        if (balance + monthlyInterest < monthlyPayment) {
            balance = 0;
        } else {
            balance = (balance + monthlyInterest) - monthlyPayment;
        }
        months++;
        
        // Safety break to prevent infinite loops
        if (months > 600) break; 
    }

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Payoff Estimate</title>
            <link rel="stylesheet" href="/style.css">
            <style>
                body { display: flex; justify-content: center; align-items: center; }
                .highlight { font-size: 28px; font-weight: bold; color: #2e86de; margin: 15px 0; }
                .interest { font-size: 20px; font-weight: bold; color: #e74c3c; margin-bottom: 20px; }
            </style>
        </head>
        <body>
            <div class="container" style="text-align: center;">
                <h2>Your Plan</h2>
                <p style="margin-top: 20px;">Time to become debt-free:</p>
                <div class="highlight">${months} Months</div>
                <p>Total interest you will pay:</p>
                <div class="interest">$${totalInterestPaid.toFixed(2)}</div>
                <p style="font-size: 13px; color: #7f8c8d;">Total payments made: $${(originalBalance + totalInterestPaid).toFixed(2)}</p>
                <a href="/payoff" style="display: inline-block; margin-top: 20px; text-decoration: none; color: #3498db; font-weight: bold;">← Calculate Again</a>
            </div>
        </body>
        </html>
    `);
});

// 5. Clear History Route
app.post('/clear', async (req, res) => {
    try {
        await db.remove({}, { multi: true }); 
        res.redirect('/');
    } catch (err) {
        res.status(500).send("Error clearing the database.");
    }
});

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});