(function () {
  'use strict';

  /************** 工具函数 **************/
  function addStyle(css) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  async function request(url, headers = {}) {
    const resp = await fetch(url, {
      method: "GET",
      headers,
      credentials: "include"
    });
    if (!resp.ok) throw new Error("请求失败 " + resp.status);
    return resp.text();
  }

  function downloadCSV(csvData, filename) {
    const blob = new Blob([csvData], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    chrome.runtime.sendMessage(
      { action: "downloadCSV", url: url, filename: filename },
      response => {
        if (response && response.success) {
          console.log("下载成功:", response.id);
        } else {
          console.error("下载失败:", response?.error);
        }
        URL.revokeObjectURL(url);
      }
    );
  }

  function escapeCsv(value) {
    if (typeof value === "string") {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  /************** 样式 **************/
  addStyle(`
    #red-comment-crawler {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 9999;
      background: white;
      border: 1px solid #e7e7e7;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      padding: 0;
      width: 300px;
      font-family: 'Microsoft YaHei', sans-serif;
      overflow: hidden;
    }
    .crawler-header { display:flex;justify-content:space-between;align-items:center;padding:10px 15px;background:#f5f5f5;cursor:pointer;border-bottom:1px solid #eee;}
    .crawler-title { font-size:16px;font-weight:bold;color:#ff2442;}
    .crawler-toggle { font-size:18px;color:#999;transition:transform 0.3s;}
    .crawler-body { padding:15px;display:none;}
    .crawler-stats { display:flex;justify-content:space-between;font-size:12px;color:#666;margin-bottom:10px;}
    .crawler-buttons { display:flex;gap:10px;margin-bottom:10px;}
    .crawler-btn { flex:1;padding:8px 0;border:none;border-radius:4px;cursor:pointer;font-size:14px;transition:all 0.2s;}
    .btn-start { background:#ff2442;color:white;}
    .btn-start:hover { background:#e01e3a;}
    .btn-pause { background:#ff9800;color:white;}
    .btn-pause:hover { background:#e68900;}
    .btn-download { background:#52c41a;color:white;}
    .btn-download:hover { background:#389e0d;}
    .crawler-log { max-height:150px;overflow-y:auto;font-size:12px;color:#666;border:1px solid #eee;border-radius:4px;padding:8px;background:#fafafa;}
    .log-entry { margin-bottom:4px;line-height:1.4;}
    .log-time { color:#999;margin-right:5px;}
    .log-error { color:#ff4d4f;}
    .log-warning { color:#faad14;}
    .watermark { text-align:center;font-size:10px;color:#aaa;padding:5px;border-top:1px solid #eee;background:#f9f9f9;}
    .expanded .crawler-toggle { transform:rotate(180deg);}
    .expanded .crawler-body { display:block;}
  `);

  /************** UI **************/
  const container = document.createElement("div");
  container.id = "red-comment-crawler";
  container.innerHTML = `
    <div class="crawler-header">
      <div class="crawler-title">小红书评论爬取工具</div>
      <div class="crawler-toggle">▼</div>
    </div>
    <div class="crawler-body">
      <div class="crawler-stats">
        <span>已爬取: <span id="crawled-count">0</span> 条</span>
        <span>状态: <span id="crawler-status">就绪</span></span>
      </div>
      <div class="crawler-buttons">
        <button class="crawler-btn btn-start" id="start-crawl">开始爬取</button>
        <button class="crawler-btn btn-pause" id="pause-crawl" disabled>暂停</button>
        <button class="crawler-btn btn-download" id="download-csv" disabled>下载CSV</button>
      </div>
      <div class="crawler-log" id="crawler-log"></div>
    </div>
    <div class="watermark">Created by Ldyer</div>
  `;
  document.body.appendChild(container);

  const header = container.querySelector(".crawler-header");
  const toggleBtn = container.querySelector(".crawler-toggle");
  const startBtn = container.querySelector("#start-crawl");
  const pauseBtn = container.querySelector("#pause-crawl");
  const downloadBtn = container.querySelector("#download-csv");
  const crawledCount = container.querySelector("#crawled-count");
  const crawlerStatus = container.querySelector("#crawler-status");
  const crawlerLog = container.querySelector("#crawler-log");

  let isExpanded = false;
  header.addEventListener("click", () => {
    isExpanded = !isExpanded;
    container.classList.toggle("expanded", isExpanded);
  });

  /************** 状态变量 **************/
  let isCrawling = false;
  let isPaused = false;
  let stopRequested = false;
  let count = 0;
  let csvData = "";
  let rows = [];
  let noteTitle = ""; // 爬取时保存标题

  const headers = [
    "用户ID","用户名","性别","年龄","星座","发表日期","主页IP","评论IP",
    "评论内容","点赞数量","回复数量","用户简介","关注","粉丝","获赞与收藏","笔记数量"
  ];

  function addLog(message, type = "info") {
    const now = new Date();
    const timeStr = now.toTimeString().substring(0, 8);
    const logEntry = document.createElement("div");
    logEntry.className = "log-entry";
    if (type === "error") logEntry.classList.add("log-error");
    if (type === "warning") logEntry.classList.add("log-warning");
    logEntry.innerHTML = `<span class="log-time">[${timeStr}]</span> ${message}`;
    crawlerLog.appendChild(logEntry);
    crawlerLog.scrollTop = crawlerLog.scrollHeight;
  }

  /************** 核心逻辑 **************/
  async function get_user(user_id, xsec_token) {
    try {
      const text = await request(
        `https://www.xiaohongshu.com/user/profile/${user_id}?xsec_token=${xsec_token}&xsec_source=pc_comment`,
        { "Referer": window.location.href, "User-Agent": navigator.userAgent }
      );
      const matched = text.match(/<script>(.+?)<\/script>/g);
      if (!matched) return ["","","","","","","","",""];
      let jsonStr = matched[matched.length - 1]
        .replace("<script>", "")
        .replace("</script>", "")
        .replace("window.__INITIAL_STATE__=", "")
        .replace(/\bundefined\b/g, "null");
      let user_data = {};
      try { user_data = JSON.parse(jsonStr).user; } catch { return ["","","","","","","","",""]; }

      const basicInfo = user_data.userPageData?.basicInfo || {};
      const interactions = user_data.userPageData?.interactions || [];
      const tags = user_data.userPageData?.tags || [];
      const notes = user_data.notes || [];

      let gender = "";
      if (basicInfo.gender === 0) gender = "男";
      else if (basicInfo.gender === 1) gender = "女";

      let age = "", constellation = "";
      tags.forEach(tag => {
        if (tag.name?.includes("岁")) age = tag.name;
        if (tag.name?.includes("座")) constellation = tag.name;
      });

      const follows = interactions[0]?.count || "";
      const fans = interactions[1]?.count || "";
      const interaction = interactions[2]?.count || "";
      let notes_counts = notes.length > 0 ? notes[0].length : 0;
      if (notes_counts >= 30) notes_counts = "30+";

      return [gender, age, constellation, basicInfo.ipLocation || "",
              basicInfo.desc || "", follows, fans, interaction, notes_counts];
    } catch {
      return ["","","","","","","","",""];
    }
  }

  async function get_data(note_id, xsec_token, cursor = "", top_comment_id = "") {
    if (stopRequested) {
      isCrawling = false;
      stopRequested = false;
      crawlerStatus.textContent = "已停止";
      startBtn.disabled = false;
      pauseBtn.disabled = true;
      downloadBtn.disabled = rows.length === 0;
      addLog("爬取已停止");
      return;
    }

    try {
      const url = `https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=${note_id}&cursor=${cursor}&top_comment_id=${top_comment_id}&image_formats=jpg,webp,avif&xsec_token=${xsec_token}`;
      const respText = await request(url, {
        "Referer": window.location.href,
        "User-Agent": navigator.userAgent
      });
      const data = JSON.parse(respText);
      const comments = data.data?.comments || [];

      for (let comment of comments) {
        if (stopRequested) break;
        while (isPaused) {
          crawlerStatus.textContent = "已暂停";
          await new Promise(r => setTimeout(r, 500));
        }
        await new Promise(r => setTimeout(r, 200));
        const user_id = comment.user_info?.user_id || "";
        const user_xsec_token = comment.user_info?.xsec_token || "";
        const nickname = comment.user_info?.nickname || "";
        const content = comment.content || "";
        const create_time = comment.create_time ? new Date(comment.create_time).toLocaleString() : "";
        const ip_location = comment.ip_location || "";
        const like_count = comment.like_count || 0;
        const sub_comment_count = comment.sub_comment_count || 0;

        const [gender, age, constellation, ipLocation, desc, follows, fans, interaction, notes_counts] =
          await get_user(user_id, user_xsec_token);

        const row = [
          user_id, nickname, gender, age, constellation, create_time,
          ipLocation, ip_location, content, like_count, sub_comment_count, desc,
          follows, fans, interaction, notes_counts
        ].map(escapeCsv);

        rows.push(row.join(","));
        count++;
        crawledCount.textContent = count;
        crawlerStatus.textContent = "爬取中...";
        addLog(`已爬取用户: ${nickname} 的评论`);
      }

      if (data.data?.has_more && !stopRequested) {
        addLog(`继续爬取下一页，当前已爬取 ${count} 条`);
        await get_data(note_id, xsec_token, data.data.cursor, top_comment_id);
      } else if (!stopRequested) {
        isCrawling = false;
        crawlerStatus.textContent = "完成";
        startBtn.disabled = false;
        pauseBtn.disabled = true;
        downloadBtn.disabled = false;
        addLog(`评论爬取完成！总共爬取 ${count} 条`);
        csvData = "\ufeff" + [headers.join(","), ...rows].join("\n");
        addLog('爬取完成！点击"下载CSV"按钮保存数据');
      }
    } catch (e) {
      addLog(`评论获取失败: ${e}`, "error");
    }
  }

  /************** 按钮事件 **************/
  startBtn.addEventListener("click", async () => {
    if (isCrawling) return;
    if (!confirm("爬取过程中可以暂时离开页面，但请勿刷新页面！")) return;
    isCrawling = true;
    isPaused = false;
    stopRequested = false;
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    downloadBtn.disabled = true;
    crawlerStatus.textContent = "爬取中...";
    crawledCount.textContent = "0";
    count = 0;
    csvData = "";
    rows = [];
    crawlerLog.innerHTML = "";

    // ⭐ 开始时记录标题
    noteTitle = document.title.replace(" - 小红书", "");
    addLog(`开始爬取: ${noteTitle}`);

    const url = window.location.href;
    const noteId = (url.match(/explore\/([^?]+)/) || [])[1];
    const xsec_token = (url.match(/xsec_token=([^&]+)/) || [])[1];

    if (!noteId) {
      isCrawling = false;
      crawlerStatus.textContent = "错误";
      startBtn.disabled = false;
      pauseBtn.disabled = true;
      addLog("无法获取笔记ID", "error");
      return;
    }

    addLog(`笔记ID: ${noteId}`);
    await get_data(noteId, xsec_token);
  });

  pauseBtn.addEventListener("click", () => {
    if (!isCrawling) return;
    if (!isPaused) {
      isPaused = true;
      pauseBtn.textContent = "继续";
      crawlerStatus.textContent = "已暂停";
      addLog("已暂停爬取");
      downloadBtn.disabled = false;
    } else {
      isPaused = false;
      pauseBtn.textContent = "暂停";
      crawlerStatus.textContent = "爬取中...";
      addLog("继续爬取");
      downloadBtn.disabled = true;
    }
  });

  downloadBtn.addEventListener("click", () => {
    if (!rows.length) {
      addLog("没有评论数据可下载", "error");
      return;
    }
    const partialCsv = "\ufeff" + [headers.join(","), ...rows].join("\n");
    downloadCSV(partialCsv, noteTitle + ".csv");
  });
})();
