function doGet(e) {
  const sheetId = 'YOUR_SHEET_ID'; // USER: REPLACE THIS WITH YOUR SHEET ID
  const action = e.parameter.action;
  
  if (action === 'update') return handleUpdate(sheetId);
  if (action === 'news') return handleNews(sheetId);
  if (action === 'servers') return handleServers(sheetId);
  if (action === 'login') return handleLogin(sheetId, e.parameter.username, e.parameter.password);
  if (action === 'signup') return handleSignup(sheetId, e.parameter.username, e.parameter.password);
  if (action === 'updateStatus') return handleUpdateStatus(sheetId, e.parameter.username, e.parameter.status, e.parameter.activity, e.parameter.details);
  if (action === 'heartbeat') return handleHeartbeat(sheetId, e.parameter.username);
  if (action === 'friendRequest') return handleFriendRequest(sheetId, e.parameter.from, e.parameter.to, e.parameter.op);
  if (action === 'getFriends') return handleGetFriends(sheetId, e.parameter.username);
  if (action === 'updateNametag') return handleUpdateNametag(sheetId, e.parameter.username, e.parameter.config);
  if (action === 'sendMessage') return handleSendMessage(sheetId, e.parameter.from, e.parameter.to, e.parameter.msg);
  if (action === 'getMessages') return handleGetMessages(sheetId, e.parameter.u1, e.parameter.u2);
  if (action === 'updateProfile') return handleUpdateProfile(sheetId, e.parameter.username, e.parameter.bio, e.parameter.pfp);

  return ContentService.createTextOutput(JSON.stringify({ error: "Invalid action" })).setMimeType(ContentService.MimeType.JSON);
}

function getSheet(sheetId, name) {
  const ss = SpreadsheetApp.openById(sheetId);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    // Add default headers if sheet is new
    if (name === 'Users') sheet.appendRow(['Username', 'Password', 'LastLogin', 'ResetPasswordOnLogin', 'Playtime', 'Status', 'Activity', 'ActivityDetails', 'NametagConfig', 'Bio', 'PFP']);
    if (name === 'Friends') sheet.appendRow(['User1', 'User2', 'Status']);
    if (name === 'Servers') sheet.appendRow(['Name', 'IconURL', 'IP', 'ShortDescription']);
    if (name === 'Messages') sheet.appendRow(['Sender', 'Receiver', 'Message', 'Timestamp']);
  }
  return sheet;
}

function handleSignup(sheetId, username, password) {
  const sheet = getSheet(sheetId, 'Users');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === username) return jsonResponse({ error: "Username already exists" });
  }
  sheet.appendRow([username, password, new Date(), 'FALSE', 0, 'Offline', '', '', '{}', 'Hello! I am using Packet Launcher.', '']);
  return jsonResponse({ success: true });
}

function handleLogin(sheetId, username, password) {
  const sheet = getSheet(sheetId, 'Users');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === username && data[i][1] === password) {
      sheet.getRange(i + 1, 3).setValue(new Date()); // Update LastLogin
      sheet.getRange(i + 1, 6).setValue('Online');
      const headers = data[0];
      const user = {};
      for (let j = 0; j < headers.length; j++) user[headers[j]] = data[i][j];
      return jsonResponse({ success: true, user: user });
    }
  }
  return jsonResponse({ error: "Invalid credentials" });
}

function handleUpdateStatus(sheetId, username, status, activity, details) {
  const sheet = getSheet(sheetId, 'Users');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === username) {
      if (status) sheet.getRange(i + 1, 6).setValue(status);
      if (activity) sheet.getRange(i + 1, 7).setValue(activity);
      if (details) sheet.getRange(i + 1, 8).setValue(details);
      return jsonResponse({ success: true });
    }
  }
  return jsonResponse({ error: "User not found" });
}

function handleHeartbeat(sheetId, username) {
  const sheet = getSheet(sheetId, 'Users');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === username) {
      const currentPlaytime = parseInt(data[i][4]) || 0;
      sheet.getRange(i + 1, 5).setValue(currentPlaytime + 1); // +1 minute
      return jsonResponse({ success: true, playtime: currentPlaytime + 1 });
    }
  }
  return jsonResponse({ error: "User not found" });
}

function handleGetFriends(sheetId, username) {
  const fSheet = getSheet(sheetId, 'Friends');
  const uSheet = getSheet(sheetId, 'Users');
  const fData = fSheet.getDataRange().getValues();
  const uData = uSheet.getDataRange().getValues();
  
  const friends = [];
  const friendRequests = [];

  for (let i = 1; i < fData.length; i++) {
    const [u1, u2, status] = fData[i];
    let other = null;
    let isRequest = false;

    if (u1 === username) {
      other = u2;
      if (status === 'Pending') isRequest = false; // Outgoing
    } else if (u2 === username) {
      other = u1;
      if (status === 'Pending') isRequest = true; // Incoming
    }

    if (other) {
      const userData = uData.find(r => r[0] === other);
      const friendObj = {
        username: other,
        status: status,
        onlineStatus: userData ? userData[5] : 'Offline',
        activity: userData ? userData[6] : '',
        activityDetails: userData ? userData[7] : '',
        nametagConfig: userData ? userData[8] : '{}',
        playtime: userData ? userData[4] : 0,
        bio: userData ? userData[9] : '',
        pfp: userData ? userData[10] : ''
      };

      if (status === 'Accepted') friends.push(friendObj);
      else if (isRequest) friendRequests.push(friendObj);
    }
  }
  return jsonResponse({ friends, friendRequests });
}

function handleFriendRequest(sheetId, from, to, op) {
  if (from === to) return jsonResponse({ error: "You cannot friend yourself" });
  
  const sheet = getSheet(sheetId, 'Friends');
  const data = sheet.getDataRange().getValues();

  if (op === 'send') {
    // Check if user exists
    const uSheet = getSheet(sheetId, 'Users');
    const uData = uSheet.getDataRange().getValues();
    if (!uData.some(r => r[0] === to)) return jsonResponse({ error: "User not found" });

    // Check for existing request
    for (let i = 1; i < data.length; i++) {
      if ((data[i][0] === from && data[i][1] === to) || (data[i][0] === to && data[i][1] === from)) {
        return jsonResponse({ error: "Friend request already exists or you are already friends" });
      }
    }
    sheet.appendRow([from, to, 'Pending']);
    return jsonResponse({ success: true });
  }

  for (let i = 1; i < data.length; i++) {
    if ((data[i][0] === from && data[i][1] === to) || (data[i][0] === to && data[i][1] === from)) {
      if (op === 'accept') sheet.getRange(i + 1, 3).setValue('Accepted');
      if (op === 'reject') sheet.deleteRow(i + 1);
      return jsonResponse({ success: true });
    }
  }
  return jsonResponse({ error: "Request not found" });
}

function handleSendMessage(sheetId, from, to, msg) {
  const sheet = getSheet(sheetId, 'Messages');
  sheet.appendRow([from, to, msg, new Date()]);
  return jsonResponse({ success: true });
}

function handleGetMessages(sheetId, u1, u2) {
  const sheet = getSheet(sheetId, 'Messages');
  const data = sheet.getDataRange().getValues();
  const messages = [];
  
  for (let i = 1; i < data.length; i++) {
    const [sender, receiver, msg, time] = data[i];
    if ((sender === u1 && receiver === u2) || (sender === u2 && receiver === u1)) {
      messages.push({ sender, receiver, msg, time });
    }
  }
  
  // Return last 50 messages
  return jsonResponse(messages.slice(-50));
}

function handleServers(sheetId) {
  const sheet = getSheet(sheetId, 'Servers');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const items = [];
  for (let i = 1; i < data.length; i++) {
    const item = {};
    for (let j = 0; j < headers.length; j++) item[headers[j]] = data[i][j];
    items.push(item);
  }
  return jsonResponse(items);
}

function handleUpdateProfile(sheetId, username, bio, pfp) {
  const sheet = getSheet(sheetId, 'Users');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === username) {
      if (bio !== undefined) sheet.getRange(i + 1, 10).setValue(bio);
      if (pfp !== undefined) sheet.getRange(i + 1, 11).setValue(pfp);
      return jsonResponse({ success: true });
    }
  }
  return jsonResponse({ error: "User not found" });
}

function handleUpdateNametag(sheetId, username, config) {
  const sheet = getSheet(sheetId, 'Users');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === username) {
      sheet.getRange(i + 1, 9).setValue(config);
      return jsonResponse({ success: true });
    }
  }
  return jsonResponse({ error: "User not found" });
}

function handleNews(sheetId) {
  const sheet = SpreadsheetApp.openById(sheetId).getSheetByName('News');
  if (!sheet) return jsonResponse({ error: "Sheet 'News' not found" });
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const newsItems = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i], item = {};
    for (let j = 0; j < headers.length; j++) item[headers[j]] = row[j];
    newsItems.push(item);
  }
  return jsonResponse(newsItems);
}

function handleUpdate(sheetId) {
  const sheet = SpreadsheetApp.openById(sheetId).getSheetByName('Updates');
  if (!sheet) return jsonResponse({ error: "Sheet 'Updates' not found" });
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return jsonResponse({ error: "No update data found" });
  const headers = data[0], latest = data[1], updateData = {};
  for (let j = 0; j < headers.length; j++) updateData[headers[j]] = latest[j];
  return jsonResponse({
    version: updateData.version, notes: updateData.notes, pub_date: updateData.pub_date,
    platforms: {
      "darwin-x86_64": { signature: updateData.sig_mac_x64, url: updateData.url_mac_x64 },
      "darwin-aarch64": { signature: updateData.sig_mac_arm, url: updateData.url_mac_arm },
      "windows-x86_64": { signature: updateData.sig_win_x64, url: updateData.url_win_x64 }
    }
  });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
