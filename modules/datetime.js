/**
 * 日期時間模組
 */
export class DateTime {
    static init() {
        this.update();
        setInterval(() => this.update(), 1000);
    }

    static update() {
        const hk = this.getHKTime();
        const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        const datetimeEl = document.getElementById('current-datetime');
        if (datetimeEl) {
            datetimeEl.innerHTML = `
                <span class="datetime-icon">⏱️</span>
                <span class="datetime-text">${hk.year}年${hk.month}月${hk.day}日 ${weekdays[hk.dayOfWeek]} ${hk.timeStr} HKT</span>
            `;
        }
    }

    static getHKTime() {
        const now = new Date();
        const hkFormatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Hong_Kong',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        
        const parts = hkFormatter.formatToParts(now);
        const getPart = (type) => parts.find(p => p.type === type)?.value || '00';
        
        const hour = parseInt(getPart('hour'));
        const minute = parseInt(getPart('minute'));
        const second = parseInt(getPart('second'));
        const year = parseInt(getPart('year'));
        const month = parseInt(getPart('month'));
        const day = parseInt(getPart('day'));
        
        // 計算星期幾（0=星期日, 6=星期六）
        const hkDate = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00+08:00`);
        const dayOfWeek = hkDate.getDay();
        
        return {
            year,
            month,
            day,
            hour,
            minute,
            second,
            dayOfWeek, // 返回數字索引 (0-6)
            dateStr: `${getPart('year')}-${getPart('month')}-${getPart('day')}`,
            timeStr: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
        };
    }
}
