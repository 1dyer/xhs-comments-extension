// content.js
// created by Ldyer from https://ldyer.top/
// 禁止商用！

(function() {
    'use strict';

    // 防止重复注入
    if (window.__xhs_export_installed) return;
    window.__xhs_export_installed = true;

    const BTN_COLOR = "#f44336";
    const BTN_GRAY = "#999";

    // 创建按钮
    const btn = document.createElement("button");
    btn.id = "xhs-export-btn";
    btn.innerText = "导出评论CSV";
    Object.assign(btn.style, {
        position: "fixed",
        top: "80px",
        right: "20px",
        zIndex: 999999,
        padding: "8px 16px",
        background: BTN_COLOR,
        color: "#fff",
        border: "none",
        borderRadius: "6px",
        cursor: "pointer",
        fontSize: "13px",
    });
    document.body.appendChild(btn);

    // 计数显示
    const counterDiv = document.createElement("div");
    counterDiv.id = "xhs-export-counter";
    Object.assign(counterDiv.style, {
        position: "fixed",
        top: "120px",
        right: "20px",
        zIndex: 999999,
        fontSize: "14px",
        color: "#222",
        background: "rgba(255,255,255,0.9)",
        padding: "6px 8px",
        borderRadius: "6px",
        boxShadow: "0 1px 6px rgba(0,0,0,0.12)"
    });
    counterDiv.innerText = "已爬取 0 条评论";
    document.body.appendChild(counterDiv);

    // CSV 头（严格按你给的顺序）
    const CSV_HEADERS = [
        "用户ID","用户名","性别","年龄","星座","发表日期","主页IP","评论IP","评论内容","点赞数量","回复数量","用户简介","关注","粉丝","获赞与收藏","笔记数量"
    ];

    // CSV 转义（每个字段都用双引号包裹并把内部双引号转为""）
    function escapeCsvCell(value) {
        if (value === null || value === undefined) value = "";
        return `"${String(value).replace(/"/g, '""')}"`;
    }

    // 简单延时函数(ms)
    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 从 user profile 页面解析 window.__INITIAL_STATE__（并把 undefined -> null）
    async function fetchUserProfile(user_id, xsec_token) {
        const url = `https://www.xiaohongshu.com/user/profile/${user_id}?xsec_token=${xsec_token}&xsec_source=pc_comment`;
        try {
            const resp = await fetch(url, { credentials: "include" });
            if (!resp || resp.status !== 200) {
                console.warn("[fetchUserProfile] 非 200 响应", resp && resp.status);
                return null;
            }
            const text = await resp.text();

            // 找所有 <script>...</script> 并取最后一个脚本内容（与之前 Python/油猴逻辑保持一致）
            const scriptRe = /<script>([\s\S]*?)<\/script>/g;
            let match, last = null;
            while ((match = scriptRe.exec(text)) !== null) {
                last = match[1];
            }
            if (!last) {
                console.warn("[fetchUserProfile] 未找到脚本块");
                return null;
            }

            // 去掉前缀并把 undefined -> null
            let jsonStr = last.replace(/^window\.__INITIAL_STATE__=/, "").replace(/\bundefined\b/g, "null");

            // 尝试解析 JSON
            let parsed;
            try {
                parsed = JSON.parse(jsonStr);
            } catch (err) {
                console.warn("[fetchUserProfile] JSON.parse 失败", err);
                return null;
            }

            return parsed.user || null;
        } catch (e) {
            console.error("[fetchUserProfile] 请求失败", e);
            return null;
        }
    }

    // 从 user_data 提取我们需要的字段（返回数组：gender, age, constellation, ipLocation, desc, follows, fans, interaction, notes_counts）
    function parseUserData(user_data) {
        if (!user_data) return ["","","","","","","","",""];
        const basicInfo = user_data.userPageData?.basicInfo || {};
        const interactions = user_data.userPageData?.interactions || [];
        const tags = user_data.userPageData?.tags || [];
        const notes = user_data.notes || [];

        let gender = "";
        if (basicInfo.gender === 0) gender = "男";
        else if (basicInfo.gender === 1) gender = "女";

        let age = "", constellation = "";
        for (const tag of tags) {
            const tn = tag?.name || "";
            if (tn.includes("岁")) age = tn;
            else if (tn.includes("座")) constellation = tn;
        }

        const follows = interactions[0]?.count || "";
        const fans = interactions[1]?.count || "";
        const interaction = interactions[2]?.count || "";
        let notes_counts = (notes && notes[0]) ? (notes[0].length || 0) : 0;
        if (notes_counts >= 30) notes_counts = "30+";

        const ipLocation = basicInfo.ipLocation || "";
        const desc = basicInfo.desc || "";

        return [gender, age, constellation, ipLocation, desc, follows, fans, interaction, notes_counts];
    }

    // 导出 CSV（使用 BOM，直接由 content script 创建 Blob 并点击下载）
    function saveCSV(filename, rows) {
        // rows：二维数组
        const bom = "\uFEFF";
        const csvText = rows.map(r => r.map(escapeCsvCell).join(",")).join("\n");
        const fullText = bom + csvText;
        const blob = new Blob([fullText], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000 * 5);
    }

    // 主循环：抓评论页并写 rows（rows 是二维数组）
    async function crawlComments(note_id, xsec_token, rows, counterObj, cursor = "", top_comment_id = "") {
        const apiUrl = `https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=${note_id}&cursor=${cursor}&top_comment_id=${top_comment_id}&image_formats=jpg,webp,avif&xsec_token=${xsec_token}`;
        try {
            const resp = await fetch(apiUrl, { credentials: "include" });
            if (!resp || resp.status !== 200) {
                console.warn("[crawlComments] comments API 非 200 响应", resp && resp.status);
                return;
            }
            const json = await resp.json();
            const data = json?.data || {};
            const comments = data.comments || [];

            for (const comment of comments) {
                // 每条间隔 0.5s
                await delay(500);

                try {
                    const user_info = comment.user_info || {};
                    const user_id = user_info.user_id || "";
                    const user_xsec_token = user_info.xsec_token || "";
                    const nickname = user_info.nickname || "";
                    const content = comment.content || "";
                    // comment.create_time 通常是毫秒（与之前逻辑一致）
                    const create_time = comment.create_time ? new Date(comment.create_time).toLocaleString() : "";
                    const ip_location = comment.ip_location || "";
                    const like_count = comment.like_count || 0;
                    const sub_comment_count = comment.sub_comment_count || 0;

                    // 获取用户主页信息（可能失败，失败则填空）
                    let user_data = await fetchUserProfile(user_id, user_xsec_token);
                    // 若为 null，则 parseUserData 会产出空字段
                    const [gender, age, constellation, ipLocation, desc, follows, fans, interaction, notes_counts] = parseUserData(user_data);

                    // 一行数据（顺序严格跟 CSV_HEADERS 对应）
                    const row = [
                        user_id,
                        nickname,
                        gender,
                        age,
                        constellation,
                        create_time,
                        ipLocation,
                        ip_location,
                        content,
                        like_count,
                        sub_comment_count,
                        desc,
                        follows,
                        fans,
                        interaction,
                        notes_counts
                    ];

                    rows.push(row);
                    counterObj.count++;
                    // 实时显示数量
                    counterDiv.innerText = `已爬取 ${counterObj.count} 条评论`;
                } catch (e) {
                    console.error("[crawlComments] 单条处理失败，跳过该条", e);
                    continue;
                }
            }

            // 是否还有下一页
            if (data.has_more) {
                const nextCursor = data.cursor || "";
                await crawlComments(note_id, xsec_token, rows, counterObj, nextCursor, top_comment_id);
            } else {
                // done
                return;
            }
        } catch (e) {
            console.error("[crawlComments] 请求或解析失败", e);
            return;
        }
    }

    // 点击处理：确认 -> 禁用按钮 -> 执行抓取 -> 导出 -> 恢复并释放
    btn.addEventListener("click", async () => {
        const ok = confirm("爬取过程中可以暂时离开页面，但请勿刷新页面！");
        if (!ok) return;

        // 提取 note_id 和 xsec_token
        const href = window.location.href;
        const noteMatch = href.match(/\/explore\/([^?\/]+)/);
        const tokenMatch = href.match(/[?&]xsec_token=([^&]+)/);
        const note_id = noteMatch ? noteMatch[1] : null;
        const xsec_token = tokenMatch ? tokenMatch[1] : null;

        if (!note_id || !xsec_token) {
            alert("未能从当前地址提取到 note_id 或 xsec_token，请确保页面 URL 包含 xsec_token 参数（或在笔记页直接打开）");
            return;
        }

        // 禁用按钮并变灰
        btn.disabled = true;
        btn.style.background = BTN_GRAY;
        btn.style.cursor = "not-allowed";
        btn.innerText = "爬取中...";

        // 准备数据结构
        let rows = [];
        rows.push(CSV_HEADERS); // 表头（二维数组）
        let counterObj = { count: 0 };
        counterDiv.innerText = `已爬取 ${counterObj.count} 条评论`;

        // 执行爬取（递归分页）
        await crawlComments(note_id, xsec_token, rows, counterObj, "", "");

        // 生成文件名（使用页面 title）
        const title = (document.title || "xhs_comments").replace(" - 小红书", "").trim();
        const filename = `${title}.csv`;

        // 导出 CSV（BOM 已在 saveCSV 中处理）
        saveCSV(filename, rows);

        // 弹窗提示（点击确定后关闭）
        alert(`爬取完成，总共提取出 ${counterObj.count} 条评论，作者博客 Ldyer.top，欢迎拜访！`);

        // 恢复按钮并释放内存
        btn.disabled = false;
        btn.style.background = BTN_COLOR;
        btn.style.cursor = "pointer";
        btn.innerText = "导出评论CSV";

        // 释放 rows（避免残留）
        rows.length = 0;
        counterObj.count = 0;
        counterDiv.innerText = `已爬取 ${counterObj.count} 条评论`;

        // 可选：短暂提示清除完成（不强制）
        // setTimeout(() => counterDiv.innerText = '', 3000);
    });

})();
