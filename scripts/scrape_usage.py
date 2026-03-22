import os
import time
import json
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# Configuration
CHROME_PROFILE_PATH = "/Users/javier/chrome-automation-profile"
OUTPUT_FILE = "/Users/javier/.openclaw/workspace/data/usage_scrape.json"

def get_openai_usage(driver):
    print("Navigating to OpenAI Usage...")
    try:
        driver.get("https://platform.openai.com/usage")
        wait = WebDriverWait(driver, 20)
        # OpenAI dashboard often takes time to load. Look for specific usage container.
        # This is a generic search for text that looks like a dollar amount.
        element = wait.until(EC.presence_of_element_located((By.XPATH, "//*[contains(text(), '$')]")))
        print(f"Found OpenAI usage data: {element.text}")
        return element.text
    except Exception as e:
        print(f"OpenAI Scrape failed: {e}")
        return None

def get_google_usage(driver):
    print("Navigating to Google AI Studio...")
    try:
        driver.get("https://aistudio.google.com/app/plan")
        time.sleep(10) # Heavy redirects on Google
        body = driver.find_element(By.TAG_NAME, "body").text
        print("Captured Google data.")
        return body[:1000]
    except Exception as e:
        print(f"Google Scrape failed: {e}")
        return None

def main():
    chrome_options = Options()
    chrome_options.add_argument(f"--user-data-dir={CHROME_PROFILE_PATH}")
    chrome_options.add_argument("--headless")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--window-size=1920,1080")

    print("Initializing ChromeDriver...")
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=chrome_options)

    results = {}
    try:
        results['openai'] = get_openai_usage(driver)
        results['google'] = get_google_usage(driver)
        
        os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
        with open(OUTPUT_FILE, 'w') as f:
            json.dump(results, f, indent=2)
        print(f"Results saved to {OUTPUT_FILE}")
    finally:
        driver.quit()

if __name__ == "__main__":
    main()
