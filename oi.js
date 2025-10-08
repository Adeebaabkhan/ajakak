const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const readline = require('readline');
const config = require('./config.json');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const fastDelay = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));
const { faker } = require('@faker-js/faker');

puppeteer.use(StealthPlugin());

// ============================================
// CAPSOLVER EXTENSION PATH & API KEY
// ============================================
const CAPSOLVER_EXTENSION_PATH = path.join(__dirname, 'capsolver');
const CAPSOLVER_API_KEY = 'CAP-AFCA92329814EC1004763FD501086A371C8058215EB04CCC8F4DB00A452A6E6F';

// ============================================
// HELPER FUNCTIONS
// ============================================

function getRandomUserAgent() {
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
}

function generateEmail() {
    const firstName = faker.person.firstName().toLowerCase();
    const randomNum = Math.floor(Math.random() * 999) + 1;
    return `${firstName}${randomNum}@${config.domain}`;
}

let browserCounter = 0;
let totalSuccessful = 0;
let totalAttempts = 0;
let availableLinks = [];
let usedLinks = [];
let userBrowserCount = 4;
let userAccountTarget = 10;
let userMode = 1;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (question) => {
    return new Promise((resolve) => {
        rl.question(question, resolve);
    });
};

async function clearBrowserData() {
    const userDataDir = path.join(__dirname, 'browser-data');
    try {
        if (fsSync.existsSync(userDataDir)) {
            await fs.rm(userDataDir, { recursive: true, force: true });
            console.log('🧹 Cleared browser data directory');
        }
    } catch (error) {
        console.log(`⚠️ Could not clear browser data: ${error.message}`);
    }
}

async function loadLinks() {
    try {
        const linksFile = 'links.txt';
        if (!fsSync.existsSync(linksFile)) {
            console.log("❌ links.txt file not found. Creating empty file...");
            await fs.writeFile(linksFile, '');
            return [];
        }
        
        const content = await fs.readFile(linksFile, 'utf8');
        const links = content.split('\n').filter(link => link.trim() !== '');
        
        console.log(`📋 Total links found: ${links.length}`);
        
        if (links.length > 0) {
            console.log(`📝 Preview of links:`);
            links.slice(0, 3).forEach((link, index) => {
                console.log(`   ${index + 1}. ${link.substring(0, 80)}...`);
            });
            if (links.length > 3) {
                console.log(`   ... and ${links.length - 3} more links`);
            }
        }
        
        return links;
    } catch (error) {
        console.log(`⚠️ Error loading links: ${error.message}`);
        return [];
    }
}

function getNextLink() {
    if (userMode === 1) return null;
    if (availableLinks.length === 0) return null;
    
    const link = availableLinks.shift();
    console.log(`🔗 Using link: ${link}`);
    console.log(`📊 Links remaining: ${availableLinks.length}`);
    
    return link;
}

function markLinkAsUsed(link) {
    if (link) {
        usedLinks.push(link);
        console.log(`✅ Link marked as successfully used (will be deleted)`);
    }
}

function returnLinkToPool(link) {
    if (link) {
        availableLinks.push(link);
        console.log(`♻️ Link returned to pool (kept in file)`);
    }
}

async function updateLinksFile() {
    try {
        // Only write back the available links (unused + returned)
        // Used links are NOT added back, so they get deleted
        const remainingContent = availableLinks.join('\n');
        await fs.writeFile('links.txt', remainingContent);
        console.log(`💾 Updated links.txt:`);
        console.log(`   ✅ Used links deleted: ${usedLinks.length}`);
        console.log(`   📋 Remaining links: ${availableLinks.length}`);
    } catch (error) {
        console.log(`⚠️ Error updating links file: ${error.message}`);
    }
}

function getWindowPosition(browserId) {
    const windowWidth = 400;
    const windowHeight = 1000;
    const margin = 5;
    const browsersPerRow = Math.floor(1920 / (windowWidth + margin));
    
    const row = Math.floor((browserId - 1) / browsersPerRow);
    const col = (browserId - 1) % browsersPerRow;
    
    return {
        x: col * (windowWidth + margin),
        y: row * (windowHeight + 50)
    };
}

async function blockAllCookies(page, browserId) {
    try {
        console.log(`[B-${browserId}] 🚫 BLOCKING COOKIES (allowing captcha)...`);
        
        await page.setRequestInterception(true);
        
        page.on('request', (request) => {
            const url = request.url();
            const resourceType = request.resourceType();
            
            if (url.includes('recaptcha') || url.includes('gstatic.com') || 
                url.includes('google.com/recaptcha') || url.includes('capsolver') ||
                url.includes('api.capsolver.com')) {
                request.continue();
                return;
            }
            
            if (url.includes('cookie') || 
                url.includes('consent') || 
                url.includes('gdpr') || 
                resourceType === 'font' ||
                resourceType === 'image') {
                request.abort();
                return;
            }
            
            request.continue();
        });
        
        await page.addStyleTag({
            content: `
                [class*="cookie" i],
                [id*="cookie" i],
                [class*="consent" i],
                [class*="gdpr" i] {
                    display: none !important;
                }
            `
        });
        
        console.log(`[B-${browserId}] ✅ COOKIES BLOCKED`);
        return true;
        
    } catch (error) {
        console.log(`[B-${browserId}] ⚠️ Cookie blocking error: ${error.message}`);
        return false;
    }
}

async function setupAdvancedStealth(page) {
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
        });
        
        window.chrome = {
            runtime: {},
            loadTimes: function() {},
            csi: function() {},
            app: {}
        };
    });
}

// ============================================
// CONFIGURE CAPSOLVER EXTENSION
// ============================================
async function configureCapSolverExtension() {
    try {
        console.log('🔧 Configuring CapSolver extension...');
        
        // Try to find and update config file
        const possibleConfigFiles = [
            path.join(CAPSOLVER_EXTENSION_PATH, 'config.json'),
            path.join(CAPSOLVER_EXTENSION_PATH, 'settings.json'),
            path.join(CAPSOLVER_EXTENSION_PATH, 'options.json')
        ];
        
        let configured = false;
        
        for (const configPath of possibleConfigFiles) {
            if (fsSync.existsSync(configPath)) {
                try {
                    const configData = JSON.parse(await fs.readFile(configPath, 'utf8'));
                    configData.apiKey = CAPSOLVER_API_KEY;
                    configData.autoSolve = true;
                    configData.enabled = true;
                    await fs.writeFile(configPath, JSON.stringify(configData, null, 2));
                    console.log(`✅ CapSolver configured in ${path.basename(configPath)}`);
                    configured = true;
                } catch (e) {
                    console.log(`⚠️ Could not update ${path.basename(configPath)}: ${e.message}`);
                }
            }
        }
        
        if (!configured) {
            // Create new config file
            const newConfigPath = path.join(CAPSOLVER_EXTENSION_PATH, 'config.json');
            const newConfig = {
                apiKey: CAPSOLVER_API_KEY,
                autoSolve: true,
                enabled: true,
                enabledForRecaptchaV2: true,
                enabledForRecaptchaV3: true,
                enabledForRecaptchaEnterprise: true
            };
            await fs.writeFile(newConfigPath, JSON.stringify(newConfig, null, 2));
            console.log('✅ CapSolver config.json created');
        }
        
    } catch (error) {
        console.log(`⚠️ CapSolver configuration warning: ${error.message}`);
        console.log('💡 Extension will need manual API key entry on first run');
    }
}

// ============================================
// CAPSOLVER EXTENSION HANDLER
// ============================================

async function waitForCapSolverToSolve(page, browserId, maxWaitTime = 120000) {
    try {
        console.log(`[B-${browserId}] 🤖 Waiting for CapSolver extension to solve...`);
        console.log(`[B-${browserId}] ⏱️ Max wait time: ${maxWaitTime / 1000}s`);
        
        const startTime = Date.now();
        
        // Wait for captcha to be solved
        await page.waitForFunction(
            () => {
                // Check if captcha iframe is gone
                const captchaIframe = document.querySelector('iframe[src*="recaptcha"]');
                if (!captchaIframe) return true;
                
                // Check if we navigated away from captcha
                const url = window.location.href;
                if (!url.includes('/recaptcha') && !url.includes('challenge')) return true;
                
                // Check if checkbox is checked
                const checkbox = document.querySelector('.recaptcha-checkbox-checked');
                if (checkbox) return true;
                
                // Check if response field is filled
                const responseField = document.querySelector('textarea[name="g-recaptcha-response"]');
                if (responseField && responseField.value && responseField.value.length > 100) {
                    return true;
                }
                
                return false;
            },
            { 
                timeout: maxWaitTime,
                polling: 1000
            }
        );
        
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[B-${browserId}] ✅ CapSolver solved in ${elapsed}s!`);
        
        await delay(2000);
        
        return true;
        
    } catch (error) {
        console.log(`[B-${browserId}] ❌ CapSolver timeout after ${maxWaitTime / 1000}s`);
        return false;
    }
}

async function handleCaptchaWithCapSolver(page, browserId) {
    try {
        console.log(`[B-${browserId}] 🎯 Captcha detected - CapSolver extension working...`);
        
        // Wait for CapSolver to solve
        const solved = await waitForCapSolverToSolve(page, browserId, 120000);
        
        if (!solved) {
            console.log(`[B-${browserId}] ❌ CapSolver failed`);
            return false;
        }
        
        console.log(`[B-${browserId}] ✅ Captcha solved by CapSolver!`);
        
        // Try to click Continue button
        console.log(`[B-${browserId}] 🖱️ Looking for Continue button...`);
        
        await delay(2000);
        
        let clickAttempts = 0;
        let buttonClicked = false;
        
        while (clickAttempts < 15 && !buttonClicked) {
            buttonClicked = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
                
                for (const button of buttons) {
                    const text = (button.textContent || button.value || '').toLowerCase();
                    
                    if (text.includes('continue') || text.includes('submit') || text.includes('next')) {
                        const rect = button.getBoundingClientRect();
                        const style = window.getComputedStyle(button);
                        
                        if (rect.width > 0 && rect.height > 0 && 
                            style.display !== 'none' && 
                            style.visibility !== 'hidden' &&
                            !button.disabled) {
                            
                            console.log('Clicking button:', text);
                            button.focus();
                            button.click();
                            
                            // Try form submit too
                            const form = button.closest('form');
                            if (form) {
                                try {
                                    form.submit();
                                } catch (e) {}
                            }
                            
                            return true;
                        }
                    }
                }
                return false;
            });
            
            if (buttonClicked) {
                console.log(`[B-${browserId}] ✅ Continue button clicked!`);
                break;
            }
            
            clickAttempts++;
            await delay(1000);
        }
        
        if (!buttonClicked) {
            console.log(`[B-${browserId}] ⚠️ Continue button not found, trying Enter key`);
            await page.keyboard.press('Enter');
        }
        
        // Wait for navigation
        try {
            await Promise.race([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
                delay(15000)
            ]);
        } catch (e) {}
        
        return true;
        
    } catch (error) {
        console.log(`[B-${browserId}] ❌ CapSolver error: ${error.message}`);
        return false;
    }
}

async function verifyStudentAccount(page, browserId, verificationUrl, email, password) {
    try {
        console.log(`[B-${browserId}] 🎓 Starting verification...`);
        
        await page.goto(verificationUrl, { 
            waitUntil: "domcontentloaded",
            timeout: 30000 
        });
        
        await fastDelay(5000);
        
        const isConfirmationPage = await page.evaluate(() => {
            const pageText = document.body.textContent.toLowerCase();
            return pageText.includes('confirm') || pageText.includes('verify') || pageText.includes('bevestigen');
        });
        
        if (isConfirmationPage) {
            console.log(`[B-${browserId}] ✅ Confirmation page!`);
            
            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, span[role="button"], a'));
                const terms = ['confirm', 'verify', 'apply', 'bevestigen', 'activate'];
                
                for (const term of terms) {
                    for (const button of buttons) {
                        const text = (button.textContent || '').trim().toLowerCase();
                        if (text.includes(term)) {
                            try {
                                if (button.closest('button')) {
                                    button.closest('button').click();
                                } else {
                                    button.click();
                                }
                                return true;
                            } catch (e) {}
                        }
                    }
                }
            });
            
            await delay(5000);
        }
        
        const accountData = `${email}:${password}\n`;
        await fs.appendFile('verifiedstudent.txt', accountData);
        console.log(`[B-${browserId}] ✅ Saved!`);
        
        return true;
        
    } catch (error) {
        console.log(`[B-${browserId}] ❌ Error: ${error.message}`);
        
        try {
            const accountData = `${email}:${password}\n`;
            await fs.appendFile('verifiedstudent.txt', accountData);
        } catch (e) {}
        
        return false;
    }
}

async function clearAndType(page, element, text) {
    await element.focus();
    await page.evaluate((el) => {
        el.select();
        el.value = '';
    }, element);
    await element.type(text, { delay: 30 });
}

// ============================================
// COMPLETE SIGNUP FLOW WITH EXACT SELECTORS
// ============================================

async function performSignupFlow(page, browserId, email, displayName) {
    try {
        // STEP 1: EMAIL
        console.log(`[B-${browserId}] ✉️ Step 1: Email`);
        
        await page.waitForSelector("input[data-testid='email'], input[name='username'], input[type='email']", { 
            timeout: 10000 
        });
        
        const emailSelectors = [
            "input[data-testid='email']",
            "input[name='username']",
            "input[type='email']",
            "#username"
        ];
        
        let emailFilled = false;
        for (const selector of emailSelectors) {
            try {
                const emailInput = await page.$(selector);
                if (emailInput) {
                    await emailInput.click();
                    await fastDelay(300);
                    await emailInput.type(email, { delay: 50 });
                    console.log(`[B-${browserId}] ✅ Email: ${email}`);
                    emailFilled = true;
                    break;
                }
            } catch (e) {
                continue;
            }
        }
        
        if (!emailFilled) throw new Error("Email input not found");
        
        await fastDelay(1500);
        
        // Click Next (Email)
        console.log(`[B-${browserId}] 🖱️ Next (Email)...`);
        const nextSelectors = [
            "button[data-testid='submit']",
            "button[data-testid='next']",
            "button[type='submit']"
        ];
        
        let clicked = false;
        for (const selector of nextSelectors) {
            try {
                const button = await page.$(selector);
                if (button) {
                    const isVisible = await page.evaluate(el => {
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    }, button);
                    
                    if (isVisible) {
                        await button.click();
                        console.log(`[B-${browserId}] ✅ Next clicked`);
                        clicked = true;
                        break;
                    }
                }
            } catch (e) {}
        }
        
        if (!clicked) {
            await page.keyboard.press('Enter');
            console.log(`[B-${browserId}] ⌨️ Enter pressed`);
        }
        
        await fastDelay(3000);
        
        // STEP 2: PASSWORD
        console.log(`[B-${browserId}] 🔐 Step 2: Password`);
        
        await page.waitForSelector("input[data-testid='password'], input[name='password'], input[type='password']", { 
            timeout: 10000 
        });
        
        const passwordSelectors = [
            "input[data-testid='password']",
            "input[name='password']",
            "input[type='password']",
            "#new-password"
        ];
        
        let passwordFilled = false;
        for (const selector of passwordSelectors) {
            try {
                const passwordInput = await page.$(selector);
                if (passwordInput) {
                    await passwordInput.click();
                    await fastDelay(300);
                    await passwordInput.type(config.password, { delay: 50 });
                    console.log(`[B-${browserId}] ✅ Password entered`);
                    passwordFilled = true;
                    break;
                }
            } catch (e) {}
        }
        
        if (!passwordFilled) throw new Error("Password input not found");
        
        await fastDelay(1500);
        
        // Click Next (Password)
        console.log(`[B-${browserId}] 🖱️ Next (Password)...`);
        clicked = false;
        for (const selector of nextSelectors) {
            try {
                const button = await page.$(selector);
                if (button) {
                    const isVisible = await page.evaluate(el => {
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    }, button);
                    
                    if (isVisible) {
                        await button.click();
                        console.log(`[B-${browserId}] ✅ Next clicked`);
                        clicked = true;
                        break;
                    }
                }
            } catch (e) {}
        }
        
        if (!clicked) {
            await page.keyboard.press('Enter');
            console.log(`[B-${browserId}] ⌨️ Enter pressed`);
        }
        
        await fastDelay(3000);
        
        // STEP 3: PROFILE
        console.log(`[B-${browserId}] 👤 Step 3: Profile`);
        
        await page.waitForSelector("input[data-testid='displayName'], input[name='displayName']", { 
            timeout: 10000 
        });
        
        const nameSelectors = [
            "input[data-testid='displayName']",
            "input[name='displayName']",
            "#displayName"
        ];
        
        for (const selector of nameSelectors) {
            try {
                const nameInput = await page.$(selector);
                if (nameInput) {
                    await nameInput.click();
                    await fastDelay(300);
                    await nameInput.type(displayName, { delay: 50 });
                    console.log(`[B-${browserId}] ✅ Name: ${displayName}`);
                    break;
                }
            } catch (e) {}
        }
        
        // Birth date
        const age = 18 + Math.floor(Math.random() * 8);
        const currentYear = new Date().getFullYear();
        const birthYear = currentYear - age;
        const birthMonth = Math.floor(Math.random() * 12) + 1;
        const birthDay = Math.floor(Math.random() * 28) + 1;
        
        await fastDelay(500);
        
        const dayInput = await page.$("input[data-testid='day'], input[name='day']");
        if (dayInput) await clearAndType(page, dayInput, birthDay.toString().padStart(2, '0'));
        
        const monthSelect = await page.$("select[data-testid='month'], select[name='month']");
        if (monthSelect) await monthSelect.select(birthMonth.toString());
        
        const yearInput = await page.$("input[data-testid='year'], input[name='year']");
        if (yearInput) await clearAndType(page, yearInput, birthYear.toString());
        
        await fastDelay(500);
        
        // Gender
        try {
            const genderRadios = await page.$$("input[name='gender']");
            if (genderRadios[0]) await genderRadios[0].click();
        } catch (e) {}
        
        await fastDelay(1500);
        
        // Next to Terms
        console.log(`[B-${browserId}] 🖱️ Next (Profile)...`);
        clicked = false;
        for (const selector of nextSelectors) {
            try {
                const button = await page.$(selector);
                if (button) {
                    const isVisible = await page.evaluate(el => {
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    }, button);
                    
                    if (isVisible) {
                        await button.click();
                        console.log(`[B-${browserId}] ✅ Next clicked`);
                        clicked = true;
                        break;
                    }
                }
            } catch (e) {}
        }
        
        if (!clicked) {
            await page.keyboard.press('Enter');
        }
        
        await fastDelay(3000);
        
        // STEP 4: TERMS
        console.log(`[B-${browserId}] 📋 Step 4: Terms`);
        
        try {
            const checkboxes = await page.$$('input[type="checkbox"]');
            for (const checkbox of checkboxes) {
                const isChecked = await page.evaluate(el => el.checked, checkbox);
                if (isChecked) await checkbox.click();
            }
        } catch (e) {}
        
        await fastDelay(1000);
        
        // Final Submit
        console.log(`[B-${browserId}] 🚀 Final Submit...`);
        const submitSelectors = [
            "button[data-testid='submit']",
            "button[data-testid='signup']",
            "button[type='submit']"
        ];
        
        let submitted = false;
        for (const selector of submitSelectors) {
            try {
                const button = await page.$(selector);
                if (button) {
                    const isVisible = await page.evaluate(el => {
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    }, button);
                    
                    if (isVisible) {
                        await button.click();
                        console.log(`[B-${browserId}] ✅ Submitted!`);
                        submitted = true;
                        break;
                    }
                }
            } catch (e) {}
        }
        
        if (!submitted) {
            await page.keyboard.press('Enter');
        }
        
        // Wait for navigation
        try {
            await Promise.race([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }),
                delay(10000)
            ]);
        } catch (e) {}
        
        await delay(5000);
        
        console.log(`[B-${browserId}] 📍 Current URL: ${page.url()}`);
        
        // Check for captcha
        console.log(`[B-${browserId}] 🔍 Checking captcha...`);
        
        let captchaAttempts = 0;
        const maxCaptchaAttempts = 3;
        
        while (captchaAttempts < maxCaptchaAttempts) {
            const captchaPresent = await page.evaluate(() => {
                return document.querySelector('iframe[src*="recaptcha"]') !== null;
            });
            
            if (captchaPresent) {
                console.log(`[B-${browserId}] 🎯 CAPTCHA! (${captchaAttempts + 1}/${maxCaptchaAttempts})`);
                
                const solved = await handleCaptchaWithCapSolver(page, browserId);
                
                if (solved) {
                    console.log(`[B-${browserId}] ✅ Captcha solved!`);
                    await delay(5000);
                    break;
                }
            } else {
                console.log(`[B-${browserId}] ✅ No captcha`);
                break;
            }
            
            captchaAttempts++;
            await delay(5000);
        }
        
        // Wait for completion
        console.log(`[B-${browserId}] ⏳ Waiting for completion...`);
        
        await page.waitForFunction(
            () => {
                const url = window.location.href;
                return (url.includes("spotify.com") && 
                       !url.includes("signup") &&
                       !url.includes("challenge")) ||
                       url.includes("open.spotify.com");
            },
            { timeout: 45000 }
        );
        
        console.log(`[B-${browserId}] ✅ SIGNUP COMPLETED!`);
        return true;
        
    } catch (error) {
        console.log(`[B-${browserId}] ❌ Signup error: ${error.message}`);
        throw error;
    }
}

async function signupOnly() {
    const extensionExists = fsSync.existsSync(CAPSOLVER_EXTENSION_PATH);
    if (!extensionExists) {
        throw new Error('CapSolver extension not found at ./capsolver/');
    }
    
    browserCounter++;
    const browserId = browserCounter;
    const windowPos = getWindowPosition(browserId);
    
    const userDataDir = path.join(__dirname, 'browser-data', `profile-${browserId}`);
    
    const browser = await puppeteer.launch({
        headless: false,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-web-security",
            "--disable-blink-features=AutomationControlled",
            `--disable-extensions-except=${CAPSOLVER_EXTENSION_PATH}`,
            `--load-extension=${CAPSOLVER_EXTENSION_PATH}`,
            `--window-size=400,1000`,
            `--window-position=${windowPos.x},${windowPos.y}`,
            `--user-data-dir=${userDataDir}`
        ],
        defaultViewport: { width: 400, height: 1000 }
    });
    
    try {
        const email = generateEmail();
        const displayName = config.username || 'ABD';
        
        console.log(`[B-${browserId}] 🚀 SIGNUP: ${email}`);
        
        const page = await browser.newPage();
        
        // Configure CapSolver in page context
        await page.evaluateOnNewDocument((apiKey) => {
            try {
                localStorage.setItem('capsolver_api_key', apiKey);
                localStorage.setItem('capsolver_auto_solve', 'true');
                localStorage.setItem('capsolver_enabled', 'true');
                localStorage.setItem('CAPSOLVER_CONFIG', JSON.stringify({
                    apiKey: apiKey,
                    autoSolve: true,
                    enabled: true,
                    enabledForRecaptchaV2: true,
                    enabledForRecaptchaEnterprise: true
                }));
            } catch (e) {}
        }, CAPSOLVER_API_KEY);
        
        await delay(2000);
        
        await page.setUserAgent(getRandomUserAgent());
        await setupAdvancedStealth(page);
        await blockAllCookies(page, browserId);
        
        console.log(`[B-${browserId}] 📱 Loading signup...`);
        await page.goto('https://www.spotify.com/signup', { 
            waitUntil: "domcontentloaded",
            timeout: 20000 
        });
        
        await fastDelay(2000);
        await performSignupFlow(page, browserId, email, displayName);
        
        const accountData = `${email}:${config.password}\n`;
        await fs.appendFile('spotify.txt', accountData);
        console.log(`[B-${browserId}] 💾 Saved to spotify.txt!`);
        console.log(`📧 ${email}`);
        console.log(`🔐 ${config.password}`);
        
        return true;

    } catch (error) {
        console.log(`[B-${browserId}] ❌ Error: ${error.message}`);
        return false;
    } finally {
        try {
            await browser.close();
            const userDataDir = path.join(__dirname, 'browser-data', `profile-${browserId}`);
            await fs.rm(userDataDir, { recursive: true, force: true });
        } catch (e) {}
    }
}

async function signupAndVerify() {
    const spotifyLink = getNextLink();
    if (!spotifyLink) {
        console.log(`❌ No links available!`);
        return false;
    }
    
    const extensionExists = fsSync.existsSync(CAPSOLVER_EXTENSION_PATH);
    if (!extensionExists) {
        throw new Error('CapSolver extension not found at ./capsolver/');
    }
    
    browserCounter++;
    const browserId = browserCounter;
    const windowPos = getWindowPosition(browserId);
    
    const userDataDir = path.join(__dirname, 'browser-data', `profile-${browserId}`);
    
    const browser = await puppeteer.launch({
        headless: false,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-web-security",
            "--disable-blink-features=AutomationControlled",
            `--disable-extensions-except=${CAPSOLVER_EXTENSION_PATH}`,
            `--load-extension=${CAPSOLVER_EXTENSION_PATH}`,
            `--window-size=400,1000`,
            `--window-position=${windowPos.x},${windowPos.y}`,
            `--user-data-dir=${userDataDir}`
        ],
        defaultViewport: { width: 400, height: 1000 }
    });
    
    let verificationSuccessful = false;
    
    try {
        const email = generateEmail();
        const displayName = config.username || 'ABD';
        
        console.log(`[B-${browserId}] 🚀 SIGNUP + VERIFY: ${email}`);
        console.log(`[B-${browserId}] 🔗 Link: ${spotifyLink}`);
        
        const page = await browser.newPage();
        
        // Configure CapSolver
        await page.evaluateOnNewDocument((apiKey) => {
            try {
                localStorage.setItem('capsolver_api_key', apiKey);
                localStorage.setItem('capsolver_auto_solve', 'true');
                localStorage.setItem('capsolver_enabled', 'true');
            } catch (e) {}
        }, CAPSOLVER_API_KEY);
        
        await delay(2000);
        
        await page.setUserAgent(getRandomUserAgent());
        await setupAdvancedStealth(page);
        await blockAllCookies(page, browserId);
        
        await page.goto('https://www.spotify.com/signup', { 
            waitUntil: "domcontentloaded",
            timeout: 20000 
        });
        
        await fastDelay(2000);
        await performSignupFlow(page, browserId, email, displayName);
        
        // Verification
        console.log(`[B-${browserId}] 🎓 Starting verification...`);
        verificationSuccessful = await verifyStudentAccount(page, browserId, spotifyLink, email, config.password);
        
        if (verificationSuccessful) {
            console.log(`[B-${browserId}] ✅ VERIFICATION SUCCESS!`);
            markLinkAsUsed(spotifyLink); // This link will be DELETED from file
            return true;
        } else {
            console.log(`[B-${browserId}] ⚠️ VERIFICATION FAILED!`);
            returnLinkToPool(spotifyLink); // This link will be KEPT in file
            return false;
        }

    } catch (error) {
        console.log(`[B-${browserId}] ❌ Error: ${error.message}`);
        if (!verificationSuccessful) returnLinkToPool(spotifyLink); // Keep link if failed
        return false;
    } finally {
        try {
            await browser.close();
            const userDataDir = path.join(__dirname, 'browser-data', `profile-${browserId}`);
            await fs.rm(userDataDir, { recursive: true, force: true });
        } catch (e) {}
    }
}

async function ensureConfig() {
    try {
        await fs.access('./config.json');
        return true;
    } catch (error) {
        const defaultConfig = {
            "username": "ABD",
            "domain": "badlands.cfd",
            "password": "Gizibae123",
            "threads": 4
        };
        await fs.writeFile('./config.json', JSON.stringify(defaultConfig, null, 2));
        console.log("[+] Default config.json created");
        return true;
    }
}

async function getUserPreferences() {
    console.log("\n🎯 MODE SELECTION");
    console.log("=================");
    console.log("1 - Signup Only (saves to spotify.txt)");
    console.log("2 - Signup + Auto Verify (saves to verifiedstudent.txt)");
    
    const modeAnswer = await askQuestion(`\n🔢 Choose mode (1 or 2): `);
    userMode = parseInt(modeAnswer) || 1;
    
    if (userMode === 2 && availableLinks.length === 0) {
        console.log("❌ No links. Switching to mode 1.");
        userMode = 1;
    }
    
    const browserAnswer = await askQuestion(`🔢 Browsers? (default: 4): `);
    userBrowserCount = browserAnswer.trim() === '' ? 4 : parseInt(browserAnswer) || 4;
    
    const accountAnswer = await askQuestion(`🎯 Total accounts? (default: 10): `);
    userAccountTarget = accountAnswer.trim() === '' ? 10 : parseInt(accountAnswer) || 10;
    
    console.log(`\n✅ Configuration:`);
    console.log(`🎯 Mode: ${userMode === 1 ? 'Signup Only' : 'Signup + Verify'}`);
    console.log(`👤 Display Name: ${config.username || 'ABD'}`);
    console.log(`🔢 Browsers: ${userBrowserCount}`);
    console.log(`🎯 Target: ${userAccountTarget}`);
    console.log(`🔑 CapSolver API Key: ${CAPSOLVER_API_KEY.substring(0, 20)}...`);
    console.log(`🤖 CapSolver Extension: ENABLED`);
    
    rl.close();
}

async function main() {
    console.log("🎵 Spotify Creator - CapSolver Extension Edition");
    console.log("==================================================");
    console.log("✅ CapSolver browser extension integration");
    console.log("✅ API key auto-configuration");
    console.log("✅ Two modes: Signup Only & Signup + Verify");
    console.log(`✅ Created by: Adeebaabkhan`);
    console.log(`✅ Date: 2025-10-07 12:56:58 UTC\n`);
    
    await clearBrowserData();
    
    const configExists = await ensureConfig();
    if (!configExists) return;
    
    const extensionExists = fsSync.existsSync(CAPSOLVER_EXTENSION_PATH);
    if (!extensionExists) {
        console.log("❌ CapSolver extension not found at ./capsolver/");
        console.log("💡 Please extract the CapSolver extension to ./capsolver/ folder");
        return;
    }
    
    console.log("🔧 Configuring CapSolver extension...");
    await configureCapSolverExtension();
    
    availableLinks = await loadLinks();
    await getUserPreferences();
    
    if (userMode === 2 && availableLinks.length < userAccountTarget) {
        userAccountTarget = Math.min(userAccountTarget, availableLinks.length);
    }
    
    let batchCounter = 1;
    
    console.log(`\n🎯 Starting with ${userBrowserCount} parallel browsers...\n`);
    
    while (totalSuccessful < userAccountTarget && (userMode === 1 || availableLinks.length > 0)) {
        console.log(`\n🚀 === BATCH #${batchCounter} ===`);
        console.log(`⏰ ${new Date().toLocaleTimeString()}`);
        console.log(`🎯 Progress: ${totalSuccessful}/${userAccountTarget}`);
        if (userMode === 2) {
            console.log(`📋 Links: ${availableLinks.length}`);
        }
        
        browserCounter = 0;
        
        const remainingAccounts = userAccountTarget - totalSuccessful;
        let browsersThisBatch = Math.min(userBrowserCount, remainingAccounts);
        
        if (userMode === 2) {
            browsersThisBatch = Math.min(browsersThisBatch, availableLinks.length);
        }
        
        if (browsersThisBatch <= 0) {
            console.log("🏁 Done!");
            break;
        }
        
        const promises = Array(browsersThisBatch).fill().map((_, i) => 
            delay(i * 1000).then(async () => {
                return userMode === 1 ? await signupOnly() : await signupAndVerify();
            })
        );

        const results = await Promise.allSettled(promises);
        const successful = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
        const failed = results.length - successful;
        
        totalSuccessful += successful;
        totalAttempts += results.length;
        
        console.log(`\n📊 === BATCH #${batchCounter} RESULTS ===`);
        console.log(`✅ Success: ${successful}/${results.length}`);
        console.log(`❌ Failed: ${failed}/${results.length}`);
        console.log(`📈 Total: ${totalSuccessful}/${totalAttempts} (${((totalSuccessful/totalAttempts)*100).toFixed(1)}%)`);
        
        if (userMode === 2) await updateLinksFile();
        
        if (totalSuccessful >= userAccountTarget) {
            console.log(`\n🎉 TARGET REACHED!`);
            break;
        }
        
        if (userMode === 2 && availableLinks.length === 0) {
            console.log(`\n📝 No more links.`);
            break;
        }
        
        batchCounter++;
        await delay(5000);
    }
    
    console.log(`\n🏁 === FINAL RESULTS ===`);
    console.log(`✅ Accounts: ${totalSuccessful}/${userAccountTarget}`);
    console.log(`📊 Success rate: ${((totalSuccessful/totalAttempts)*100).toFixed(1)}%`);
    if (userMode === 2) {
        console.log(`🔗 Used (deleted): ${usedLinks.length}`);
        console.log(`📋 Remaining: ${availableLinks.length}`);
    }
    console.log(`💾 Saved to: ${userMode === 1 ? 'spotify.txt' : 'verifiedstudent.txt'}`);
    
    await clearBrowserData();
}

process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    console.log(`✅ Total successful: ${totalSuccessful || 0}`);
    
    if (userMode === 2) {
        try {
            console.log('💾 Saving links to links.txt...');
            await updateLinksFile();
            console.log(`✅ Links saved!`);
            console.log(`   ❌ Used links deleted: ${usedLinks.length}`);
            console.log(`   ✅ Remaining links kept: ${availableLinks.length}`);
        } catch (error) {
            console.log(`❌ Error saving links: ${error.message}`);
        }
    }
    
    await clearBrowserData();
    
    rl.close();
    process.exit(0);
});

main().catch(console.error);