/**
 * Path Utilities - 路径解析工具
 * 
 * 提供跨平台的路径解析功能，支持 ~ 作为用户主目录的简写
 */

const os = require('os');
const path = require('path');

/**
 * 解析路径，将 ~ 替换为用户主目录
 * @param {string} inputPath - 输入路径，可能包含 ~
 * @returns {string} 解析后的绝对路径
 */
function resolveHomePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return inputPath;
  }
  
  // 处理 ~/ 或 ~\ 开头的路径
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  
  // 处理单独的 ~
  if (inputPath === '~') {
    return os.homedir();
  }
  
  // 其他情况原样返回（已经是绝对路径或相对路径）
  return inputPath;
}

/**
 * 将绝对路径转换为用户友好的格式（用于显示）
 * @param {string} absolutePath - 绝对路径
 * @returns {string} 简写路径（如果可能在用户主目录下）
 */
function toDisplayPath(absolutePath) {
  if (!absolutePath || typeof absolutePath !== 'string') {
    return absolutePath;
  }
  
  const homeDir = os.homedir();
  
  // 如果路径在用户主目录下，转换为 ~/ 格式
  if (absolutePath.startsWith(homeDir + path.sep) || 
      absolutePath.startsWith(homeDir + '/')) {
    return '~/' + absolutePath.slice(homeDir.length + 1).replace(/\\/g, '/');
  }
  
  return absolutePath;
}

module.exports = {
  resolveHomePath,
  toDisplayPath
};
