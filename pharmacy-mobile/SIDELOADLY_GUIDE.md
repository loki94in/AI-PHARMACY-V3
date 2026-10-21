# Sideloadly Installation & Update Guide for Pharmacy Genius iOS

This guide explains how to install and update the Pharmacy Genius iOS app (`.ipa`) on your iPhone or iPad using **Sideloadly** from Windows.

---

## Prerequisites (on your Windows PC)

1. **Sideloadly installed**: Download from [sideloadly.io](https://sideloadly.io/) (free, Windows 64-bit).
2. **iTunes & iCloud (Non-Microsoft Store versions)**:
   - Sideloadly requires Apple's native driver libraries.
   - Install the standalone Apple iTunes (64-bit) and Apple iCloud setups linked from the Sideloadly website if not already present.
3. **An Apple ID**: Your standard personal Apple ID email address (no paid developer account required).

---

## How to Get the `.ipa` File

### Method 1: Using GitHub Actions (Automated Cloud Build)
1. In your GitHub repository, navigate to the **Actions** tab.
2. Select **"Build iOS IPA for Sideloadly"** from the left sidebar.
3. Click **Run workflow** -> **Run workflow**.
4. Once completed (~10-15 minutes on macOS runner), download the **`PharmacyGenius-Sideloadly`** artifact zip and extract `PharmacyGenius-Sideloadly.ipa`.

### Method 2: Using EAS Build CLI
From the `pharmacy-mobile` directory, run:
```bash
npx eas build -p ios --profile sideload
```
When complete, EAS returns a download URL for the built `.ipa`.

---

## Step-by-Step Installation via Sideloadly

1. **Connect your iPhone**:
   - Plug your iPhone into your Windows PC via USB cable.
   - Unlock your iPhone and tap **"Trust this computer"** if prompted.
2. **Launch Sideloadly**:
   - Verify your iPhone appears in the **iDevice** dropdown.
3. **Select the IPA**:
   - Drag and drop `PharmacyGenius-Sideloadly.ipa` into the IPA icon box in Sideloadly (or click the box to browse).
4. **Enter Apple ID**:
   - In the **Apple ID** field, type your Apple ID email.
5. **Start Signing & Sideloading**:
   - Click **Start**.
   - If prompted, enter your Apple ID password (and 2-Factor Authentication code sent to your phone). Sideloadly uses this only to request a free personal signing certificate from Apple.
6. **Trust the Certificate on iPhone (First Time Only)**:
   - Once Sideloadly shows `Done!`, the app icon appears on your iPhone home screen.
   - Open iPhone **Settings** -> **General** -> **VPN & Device Management**.
   - Under *Developer App*, tap your Apple ID email and tap **"Trust"**.
   - (iOS 16+) Open **Settings** -> **Privacy & Security** -> scroll to bottom -> enable **Developer Mode** (restarts phone once).
7. **Launch Pharmacy Genius**:
   - Tap the Pharmacy Genius icon on your iPhone.
   - Configure your Server URL (or let it auto-discover your PC on local Wi-Fi, or enter your tunnel URL if outside).

---

## How to Keep the App Active Forever (Never Expire / Never Run Out of Free Trial)

With a free Apple ID, Apple normally gives a **7-day expiration** per sideloaded app, and a limit of **10 App IDs** per week:

### 1. Locked Bundle ID (Zero Waste of Free App IDs)
* The app is permanently locked to Bundle ID: `com.pharmacy.genius`.
* **In Sideloadly, leave "Bundle ID" on default / unchanged.**
* Every future update or reinstall updates the **exact same app in-place**, without consuming any extra App ID slots from your Apple account. Your offline bills, medicines, and CRM data stay intact.

### 2. Sideloadly Automatic Background Refresh (Infinite Free Renewal)
Sideloadly has an automated background renewal service so the app **never expires**:
1. In Sideloadly, click the **"Advanced Options"** or look at the registered apps list.
2. Check the box for **"Automatic App Refresh"**.
3. Enable **"Wi-Fi Sideloading"**:
   * Once you sideload via USB the first time, your iPhone and PC will communicate over your pharmacy Wi-Fi network.
   * Whenever your Windows PC is running and your iPhone is on the same Wi-Fi, Sideloadly will **silently refresh the 7-day certificate in the background** before it ever runs out!
   * You will **never** see the "App is no longer available" or expired popup.

---

## How to Update the App Later

When a new version or update is ready:
1. Download the new `PharmacyGenius-Sideloadly.ipa`.
2. Open Sideloadly (phone connected via USB or Wi-Fi).
3. Drag the new `.ipa` in and click **Start**.
4. Sideloadly will overwrite and update the app **in-place**. All cached inventory, offline queues, settings, and login sessions are automatically preserved.
