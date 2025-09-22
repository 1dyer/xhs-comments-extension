chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "downloadCSV") {
    chrome.downloads.download({
      url: message.url,
      filename: message.filename,
      saveAs: true
    }, downloadId => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, id: downloadId });
      }
    });
    return true; // 保持 sendResponse 异步可用
  }
});
