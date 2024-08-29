import playwright from "playwright-chromium";
import dotenv from "dotenv";
import invariant from "tiny-invariant";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

dotenv.config();

// make sure all env variables are set
const ACCOUNT_EMAIL = process.env.ACCOUNT_EMAIL;
const ACCOUNT_PASSWORD = process.env.ACCOUNT_PASSWORD;
const GEO_LATITUDE = process.env.GEO_LATITUDE;
const GEO_LONGITUDE = process.env.GEO_LONGITUDE;
const CHECK_TYPE = process.env.CHECK_TYPE;

const PUBLIC_HOLIDAYS = [
  "23 Jan 2023", // cuti bersama imlek
  "23 Mar 2023", // nyepi
  "23 Mar 2023", // cuti bersama nyepi
  "7 Apr 2023", // wafat isa almasih
  "19 Apr 2023", // idul fitri
  "20 Apr 2023", // idul fitri
  "21 Apr 2023", // idul fitri
  "24 Apr 2023", // idul fitri
  "25 Apr 2023", // idul fitri
  "27 Apr 2023", // cuti
  "1 Mei 2023", // hari buruh
  "18 Mei 2023", // kenaikan isa almasih
  "1 Jun 2023", // hari lahir pancasila
  "2 Jun 2023", // cuti bersama waisak
  "29 Jun 2023", // idul adha
  "19 Jul 2023", // tahun baru islam
  "17 Aug 2023", // kemerdekaan indonesia
  "28 Sep 2023", // maulid nabi muhammad
  "25 Dec 2023", // natal
  "26 Dec 2023", // cuti bersama natal
];

const main = async () => {
  let browser;
  let page;
  try {
    const isHeadless = process.env.HEADLESS !== "false";
    console.log(`Running in ${isHeadless ? 'headless' : 'non-headless'} mode`);

    const TODAY = dayjs().tz("Asia/Jakarta").format("D MMM YYYY");
    console.log(`Today's date: ${TODAY}`);

    browser = await playwright["chromium"].launch({
      headless: isHeadless,
    });

    const context = await browser.newContext({
      viewport: { width: 1080, height: 560 },
      geolocation: {
        latitude: Number(process.env.GEO_LATITUDE),
        longitude: Number(process.env.GEO_LONGITUDE),
      },
      permissions: ["geolocation"],
    });

    page = await context.newPage();

    console.log("Opening login page...");
    const response = await page.goto(
      "https://account.mekari.com/users/sign_in?client_id=TAL-73645&return_to=L2F1dGg_Y2xpZW50X2lkPVRBTC03MzY0NSZyZXNwb25zZV90eXBlPWNvZGUmc2NvcGU9c3NvOnByb2ZpbGU%3D",
      { timeout: 60000 }
    );

    console.log(`Response status: ${response.status()}`);
    console.log(`Response URL: ${response.url()}`);

    console.log("Waiting for page to load...");
    await page.waitForLoadState('domcontentloaded', { timeout: 60000 });

    console.log("Checking if page loaded correctly...");
    const pageTitle = await page.title();
    console.log(`Page title: "${pageTitle}"`);

    if (!pageTitle) {
      console.log("Page title is empty. Waiting a bit longer...");
      await page.waitForTimeout(5000); // Wait for 5 seconds
      const retryTitle = await page.title();
      console.log(`Retry page title: "${retryTitle}"`);
      if (!retryTitle) {
        throw new Error("Page title is still empty after waiting");
      }
    }

    if (!pageTitle.includes("Mekari")) {
      console.log("Unexpected page title. Dumping page content...");
      const pageContent = await page.content();
      console.log("Page content:", pageContent);
      throw new Error(`Unexpected page title: ${pageTitle}`);
    }

    console.log("Waiting for email input...");
    const emailInput = await page.waitForSelector('#user_email, input[type="email"]', { timeout: 60000, state: 'visible' });
    if (!emailInput) {
      throw new Error("Email input not found");
    }

    console.log("Filling in account email...");
    await emailInput.fill(process.env.ACCOUNT_EMAIL);

    console.log("Waiting for password input...");
    const passwordInput = await page.waitForSelector('#user_password, input[type="password"]', { timeout: 60000, state: 'visible' });
    if (!passwordInput) {
      throw new Error("Password input not found");
    }

    console.log("Filling in account password...");
    await passwordInput.fill(process.env.ACCOUNT_PASSWORD);

    console.log("Waiting for sign-in button...");
    const signInButton = await page.waitForSelector('#new-signin-button, button[type="submit"]', { timeout: 60000, state: 'visible' });
    if (!signInButton) {
      throw new Error("Sign in button not found");
    }

    console.log("Clicking sign-in button...");
    await signInButton.click();

    console.log("Waiting for dashboard...");
    await page.waitForSelector('a[href="/employee/dashboard"]', { timeout: 60000 });

    const dashboardNav = page.getByText("Dashboard");
    if ((await dashboardNav.innerText()) === "Dashboard") {
      console.log("Successfully Logged in...");
    }

    const myName = (await page.locator("#navbar-name").textContent()).trim();

    async function isOffToday(page, myName) {
      await page.waitForSelector('.tl-card-small', { timeout: 60000 });
      const offPeople = await page.$$eval('.tl-leave-list__item .font-weight-bold', elems => elems.map(e => e.innerText));
      return offPeople.includes(myName);
    }

    const isUserOffToday = await isOffToday(page, myName);
    if (isUserOffToday) {
      console.log("You are off today, skipping check in/out...");
      return;
    }

    await page.click("text=My Attendance Logs");
    await page.waitForSelector('h1:text("My attendance log")', { timeout: 60000 });
    console.log("Already inside My Attendance Logs to check holiday or day-off...");

    const rowToday = page.locator("tr", { hasText: TODAY }).first();
    const columnCheckDayOff = await rowToday.locator("td:nth-child(2)").innerText();
    const columnCheckOnLeave = await rowToday.locator("td:nth-child(7)").innerText();

    const isTodayHoliday = columnCheckDayOff.trim() !== "N";
    const isTodayOnLeave = columnCheckOnLeave.trim() === "CT";
    const shouldSkipCheckInOut = isTodayHoliday || isTodayOnLeave;

    if (shouldSkipCheckInOut) {
      const consoleText = isTodayOnLeave
        ? "You are on leave (cuti) today, skipping check in/out..."
        : "You are on holiday today, skipping check in/out...";
      console.log(consoleText);
      return;
    }

    await Promise.all([
      page.goto("https://hr.talenta.co/live-attendance"),
      page.waitForNavigation(),
    ]);

    console.log("Already inside Live Attendance Page...");

    const currentTime = await page.waitForSelector(".current-time");
    const checkIn = await page.waitForSelector(".col:nth-child(1) > .btn");
    const checkOut = await page.waitForSelector(".col:nth-child(2) > .btn");

    console.log("Current Time: ", await currentTime.innerText());
    console.log("Found: ", await checkIn.innerText());
    console.log("Found: ", await checkOut.innerText());

    if (process.env.SKIP_CHECK_IN_OUT === "true") {
      console.log("Skipping Check In/Out...");
      return;
    }

    if (process.env.CHECK_TYPE === "CHECK_IN") {
      console.log("Checking In...");
      await page.click(".col:nth-child(1) > .btn");
      await page.waitForSelector('text="Successfully Clock In"', { timeout: 30000 });
      console.log("Successfully Clock In");
    } else if (process.env.CHECK_TYPE === "CHECK_OUT") {
      console.log("Checking Out...");
      await page.click(".col:nth-child(2) > .btn");
      await page.waitForSelector('text="Successfully Clock Out"', { timeout: 30000 });
      console.log("Successfully Clock Out");
    }

  } catch (error) {
    console.error("An error occurred:", error);
    if (error.message.includes("Timeout")) {
      console.log("The operation timed out. The website might be slow or unresponsive.");
    }
    throw error; // Re-throw the error to be caught by the retry mechanism
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds

const retry = async (fn, retries = MAX_RETRIES) => {
  try {
    return await fn();
  } catch (error) {
    if (retries > 0) {
      console.log(`Retrying... (${MAX_RETRIES - retries + 1}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return retry(fn, retries - 1);
    }
    throw error;
  }
};

retry(main).catch(error => {
  console.error("All retries failed:", error);
  process.exit(1);
});