const { app, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const logPath = path.join(process.cwd(), 'log.txt')

function log(msg) {
  fs.appendFileSync(logPath, msg + '\n')
}

log('===== 启动 =====')
log('环境变量: ' + JSON.stringify(process.env, null, 2))
log('命令行参数: ' + JSON.stringify(process.argv, null, 2))
log('Electron 版本: ' + process.versions.electron)
log('Node 版本: ' + process.versions.node)
log('Chrome 版本: ' + process.versions.chrome)
log('平台: ' + process.platform + ' ' + process.arch)
log('当前目录: ' + __dirname)
log('用户数据目录: ' + app.getPath('userData'))
log('日志目录: ' + path.dirname(logPath))
log('日志文件: ' + logPath)