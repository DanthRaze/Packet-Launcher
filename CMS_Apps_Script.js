function doGet(e) {
  // Replace with your actual Google Sheet ID
  const sheetId = 'YOUR_SHEET_ID';
  const action = e.parameter.action || 'news';
  
  if (action === 'update') {
    return handleUpdate(sheetId);
  } else {
    return handleNews(sheetId);
  }
}

function handleNews(sheetId) {
  const sheet = SpreadsheetApp.openById(sheetId).getSheetByName('News');
  
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ error: "Sheet 'News' not found" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const newsItems = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const item = {};
    for (let j = 0; j < headers.length; j++) {
      item[headers[j]] = row[j];
    }
    newsItems.push(item);
  }

  return ContentService.createTextOutput(JSON.stringify(newsItems))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleUpdate(sheetId) {
  const sheet = SpreadsheetApp.openById(sheetId).getSheetByName('Updates');
  
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ error: "Sheet 'Updates' not found" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return ContentService.createTextOutput(JSON.stringify({ error: "No update data found" }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // Assuming row 2 contains the latest update
  const headers = data[0];
  const latest = data[1];
  
  const updateData = {};
  for (let j = 0; j < headers.length; j++) {
    updateData[headers[j]] = latest[j];
  }

  // Tauri Updater expects a very specific JSON format
  const tauriUpdaterResponse = {
    version: updateData.version,
    notes: updateData.notes,
    pub_date: updateData.pub_date,
    platforms: {
      "darwin-x86_64": {
        signature: updateData.sig_mac_x64,
        url: updateData.url_mac_x64
      },
      "darwin-aarch64": {
        signature: updateData.sig_mac_arm,
        url: updateData.url_mac_arm
      },
      "windows-x86_64": {
        signature: updateData.sig_win_x64,
        url: updateData.url_win_x64
      }
    }
  };

  return ContentService.createTextOutput(JSON.stringify(tauriUpdaterResponse))
    .setMimeType(ContentService.MimeType.JSON);
}

// HOW TO USE FOR OTA UPDATES:
// 1. Create a tab named 'Updates'
// 2. Add headers exactly as: version, notes, pub_date, url_mac_x64, sig_mac_x64, url_mac_arm, sig_mac_arm, url_win_x64, sig_win_x64
// 3. Put the newest update info in row 2.
// 4. Redeploy as a New Deployment.
