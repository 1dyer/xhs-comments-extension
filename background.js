// background.js
// created by Ldyer from https://ldyer.top/
// 禁止商用！

chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "download") {
        chrome.downloads.download({
            url: message.url,
            filename: message.filename,
            saveAs: false
        });
    }
});
