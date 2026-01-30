/**
 * CSV 上傳處理模組
 * 處理 CSV 文件上傳、解析和驗證
 */

/**
 * 解析 CSV 文本
 */
export function parseCSVText(text) {
    if (!text || !text.trim()) return null;

    const lines = text.trim().split(/\r?\n/);
    const data = [];

    // 跳過標題行（如果存在）
    let startIndex = 0;
    if (lines[0] && lines[0].toLowerCase().includes('date')) {
        startIndex = 1;
    }

    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // 處理 CSV（可能包含引號）
        const parts = line.split(',');
        if (parts.length < 2) continue;

        const date = parts[0].trim().replace(/^"|"$/g, '');
        const attendance = parts[1].trim().replace(/^"|"$/g, '');

        // 驗證日期格式 (YYYY-MM-DD)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            console.warn(`跳過無效日期: ${date}`);
            continue;
        }

        // 驗證就診人數
        const attendanceNum = parseInt(attendance);
        if (isNaN(attendanceNum) || attendanceNum < 0) {
            console.warn(`跳過無效就診人數: ${attendance}`);
            continue;
        }

        data.push({
            date: date,
            attendance: attendanceNum
        });
    }

    return data.length > 0 ? data : null;
}

/**
 * 解析 CSV 文件
 */
export function parseCSVFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const text = e.target.result;
                const data = parseCSVText(text);
                resolve(data);
            } catch (error) {
                reject(error);
            }
        };

        reader.onerror = () => {
            reject(new Error('文件讀取失敗'));
        };

        reader.readAsText(file, 'UTF-8');
    });
}

/**
 * 驗證 CSV 數據
 */
export function validateCSVData(data) {
    if (!data || !Array.isArray(data) || data.length === 0) {
        return {
            valid: false,
            error: 'CSV 數據為空'
        };
    }

    // 檢查日期範圍
    const dates = data.map(d => new Date(d.date));
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));

    // 檢查是否有重複日期
    const dateSet = new Set(data.map(d => d.date));
    if (dateSet.size !== data.length) {
        return {
            valid: false,
            error: '存在重複日期'
        };
    }

    // 檢查就診人數範圍
    const attendances = data.map(d => d.attendance);
    const minAttendance = Math.min(...attendances);
    const maxAttendance = Math.max(...attendances);

    if (minAttendance < 0 || maxAttendance > 10000) {
        return {
            valid: false,
            error: '就診人數超出合理範圍 (0-10000)'
        };
    }

    return {
        valid: true,
        count: data.length,
        dateRange: {
            start: minDate.toISOString().split('T')[0],
            end: maxDate.toISOString().split('T')[0]
        },
        attendanceRange: {
            min: minAttendance,
            max: maxAttendance,
            avg: Math.round(attendances.reduce((a, b) => a + b, 0) / attendances.length)
        }
    };
}

/**
 * 生成 CSV 預覽 HTML
 */
export function generateCSVPreview(data, maxRows = 10) {
    if (!data || data.length === 0) return '';

    const previewData = data.slice(0, maxRows);
    const hasMore = data.length > maxRows;

    let html = '<table class="csv-preview-table">';
    html += '<thead><tr><th>日期</th><th>就診人數</th></tr></thead>';
    html += '<tbody>';

    previewData.forEach(row => {
        html += `<tr><td>${row.date}</td><td>${row.attendance}</td></tr>`;
    });

    html += '</tbody></table>';

    if (hasMore) {
        html += `<p class="preview-note">顯示前 ${maxRows} 行，共 ${data.length} 行</p>`;
    }

    return html;
}

/**
 * 上傳 CSV 數據到服務器
 */
export async function uploadCSVData(data) {
    try {
        const response = await fetch('/api/actual-data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ data: data })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || '上傳失敗');
        }

        return {
            success: true,
            inserted: result.inserted || 0,
            updated: result.updated || 0,
            message: result.message || '上傳成功'
        };
    } catch (error) {
        console.error('上傳 CSV 數據失敗:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * 初始化 CSV 上傳 UI
 */
export function initCSVUpload() {
    const dataSourceInfo = document.getElementById('data-source-info');
    const modal = document.getElementById('csv-upload-modal');
    const closeBtn = document.getElementById('csv-upload-close');
    const cancelBtn = document.getElementById('csv-upload-cancel');
    const submitBtn = document.getElementById('csv-upload-submit');
    const textInput = document.getElementById('csv-text-input');
    const fileInput = document.getElementById('csv-file-input');
    const tabs = document.querySelectorAll('.upload-tab');
    const tabContents = document.querySelectorAll('.upload-tab-content');

    let currentData = null;

    // 打開對話框
    if (dataSourceInfo) {
        dataSourceInfo.addEventListener('click', () => {
            if (modal) {
                modal.style.display = 'flex';
                textInput.focus();
            }
        });
    }

    // 關閉對話框
    function closeModal() {
        if (modal) {
            modal.style.display = 'none';
            textInput.value = '';
            fileInput.value = '';
            currentData = null;
            updateSubmitButton();
            clearPreview();
            clearStatus();
        }
    }

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.classList.contains('upload-modal-overlay')) {
                closeModal();
            }
        });
    }

    // 標籤切換
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;

            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            tabContents.forEach(content => {
                content.classList.remove('active');
                if (content.id === `upload-tab-${tabName}`) {
                    content.classList.add('active');
                    content.style.display = 'block';
                } else {
                    content.style.display = 'none';
                }
            });

            clearPreview();
            clearStatus();
            updateSubmitButton();
        });
    });

    // 文本輸入處理
    if (textInput) {
        textInput.addEventListener('input', async () => {
            const text = textInput.value;
            if (text.trim()) {
                currentData = parseCSVText(text);
                updatePreview(currentData);
                updateSubmitButton();
            } else {
                currentData = null;
                clearPreview();
                updateSubmitButton();
            }
        });
    }

    // 文件輸入處理
    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                try {
                    currentData = await parseCSVFile(file);
                    updatePreview(currentData);
                    updateSubmitButton();
                } catch (error) {
                    showStatus('error', `文件解析失敗: ${error.message}`);
                    currentData = null;
                    updateSubmitButton();
                }
            }
        });
    }

    // 提交按鈕
    if (submitBtn) {
        submitBtn.addEventListener('click', async () => {
            if (!currentData) return;

            const validation = validateCSVData(currentData);
            if (!validation.valid) {
                showStatus('error', validation.error);
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = '上傳中...';

            const result = await uploadCSVData(currentData);

            if (result.success) {
                showStatus('success', `成功上傳 ${result.inserted} 條新記錄，更新 ${result.updated} 條記錄`);
                setTimeout(() => {
                    closeModal();
                    location.reload();
                }, 2000);
            } else {
                showStatus('error', result.error);
                submitBtn.disabled = false;
                submitBtn.textContent = '上傳';
            }
        });
    }

    function updatePreview(data) {
        const previewEl = document.getElementById('csv-preview');
        if (previewEl) {
            if (data && data.length > 0) {
                previewEl.innerHTML = generateCSVPreview(data);
                previewEl.style.display = 'block';
            } else {
                previewEl.style.display = 'none';
            }
        }
    }

    function clearPreview() {
        const previewEl = document.getElementById('csv-preview');
        if (previewEl) {
            previewEl.innerHTML = '';
            previewEl.style.display = 'none';
        }
    }

    function updateSubmitButton() {
        if (submitBtn) {
            submitBtn.disabled = !currentData || currentData.length === 0;
        }
    }

    function showStatus(type, message) {
        const statusEl = document.getElementById('csv-upload-status');
        if (statusEl) {
            statusEl.className = `upload-status ${type}`;
            statusEl.textContent = message;
            statusEl.style.display = 'block';
        }
    }

    function clearStatus() {
        const statusEl = document.getElementById('csv-upload-status');
        if (statusEl) {
            statusEl.style.display = 'none';
        }
    }
}
