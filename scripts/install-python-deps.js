/**
 * 自動安裝 Python 依賴
 * Railway 部署時自動執行
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const pythonCommands = ['python3', 'python'];
const requirementsPath = path.join(__dirname, '../python/requirements.txt');

console.log('🔧 檢查 Python 環境...');

// 檢查 requirements.txt 是否存在
if (!fs.existsSync(requirementsPath)) {
    console.log('⚠️ requirements.txt 不存在，跳過 Python 依賴安裝');
    process.exit(0);
}

// 檢測可用的 Python 命令
function detectPython() {
    return new Promise((resolve) => {
        let currentIndex = 0;
        
        const tryNext = () => {
            if (currentIndex >= pythonCommands.length) {
                resolve(null);
                return;
            }
            
            const cmd = pythonCommands[currentIndex];
            const test = spawn(cmd, ['--version'], { stdio: 'pipe' });
            
            test.on('close', (code) => {
                if (code === 0) {
                    resolve(cmd);
                } else {
                    currentIndex++;
                    tryNext();
                }
            });
            
            test.on('error', () => {
                currentIndex++;
                tryNext();
            });
        };
        
        tryNext();
    });
}

// 安裝依賴
async function installDependencies() {
    const pythonCmd = await detectPython();
    
    if (!pythonCmd) {
        console.log('⚠️ Python 未找到，跳過依賴安裝');
        console.log('💡 請在 Railway 環境變數中設置 Python 或使用 Nixpacks');
        process.exit(0);
    }
    
    console.log(`✅ 找到 Python: ${pythonCmd}`);
    
    // 檢查 pip
    return new Promise((resolve) => {
        const pipCmd = pythonCmd === 'python3' ? 'pip3' : 'pip';
        
        console.log(`📦 安裝 Python 依賴...`);
        console.log(`   命令: ${pipCmd} install -r ${requirementsPath}`);
        
        const pip = spawn(pipCmd, [
            'install',
            '--upgrade',
            'pip',
            '--quiet'
        ], {
            stdio: 'inherit',
            cwd: path.join(__dirname, '../python')
        });
        
        pip.on('close', (code) => {
            if (code === 0) {
                console.log('✅ pip 升級完成');
                
                // 安裝依賴
                const install = spawn(pipCmd, [
                    'install',
                    '-r',
                    'requirements.txt',
                    '--quiet'
                ], {
                    stdio: 'inherit',
                    cwd: path.join(__dirname, '../python')
                });
                
                install.on('close', (installCode) => {
                    if (installCode === 0) {
                        console.log('✅ Python 依賴安裝完成');
                        resolve(true);
                    } else {
                        console.error(`❌ Python 依賴安裝失敗（退出碼 ${installCode}）`);
                        resolve(false);
                    }
                });
                
                install.on('error', (err) => {
                    console.error(`❌ 無法執行 pip install: ${err.message}`);
                    resolve(false);
                });
            } else {
                console.warn(`⚠️ pip 升級失敗（退出碼 ${code}），繼續嘗試安裝依賴...`);
                
                // 直接嘗試安裝依賴
                const install = spawn(pipCmd, [
                    'install',
                    '-r',
                    'requirements.txt',
                    '--quiet'
                ], {
                    stdio: 'inherit',
                    cwd: path.join(__dirname, '../python')
                });
                
                install.on('close', (installCode) => {
                    if (installCode === 0) {
                        console.log('✅ Python 依賴安裝完成');
                        resolve(true);
                    } else {
                        console.error(`❌ Python 依賴安裝失敗（退出碼 ${installCode}）`);
                        resolve(false);
                    }
                });
            }
        });
        
        pip.on('error', (err) => {
            console.error(`❌ 無法執行 pip: ${err.message}`);
            console.log('💡 請確保 Python 和 pip 已正確安裝');
            resolve(false);
        });
    });
}

// 執行安裝
installDependencies().then(success => {
    if (success) {
        console.log('🎉 Python 環境設置完成');
        process.exit(0);
    } else {
        console.log('⚠️ Python 依賴安裝未完成，但不會阻止部署');
        process.exit(0); // 不阻止部署
    }
}).catch(err => {
    console.error('❌ 安裝過程出錯:', err);
    process.exit(0); // 不阻止部署
});

