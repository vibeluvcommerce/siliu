/**
 * LoginDetector - 登录状态检测器
 * 检测页面是否需要登录，以及当前登录状态
 */

// 登录相关关键词
const LOGIN_KEYWORDS = {
  // 中文
  zh: [
    '登录', '登陆', '注册', '账号', '密码', '手机号',
    '验证码', '短信', '忘记密码', '立即登录', '手机号登录'
  ],
  // 英文
  en: [
    'login', 'sign in', 'sign up', 'register', 'password',
    'username', 'email', 'phone number', 'verification code',
    'forgot password', 'log in', 'create account'
  ]
};

// 已登录标识
const LOGGED_IN_INDICATORS = {
  // 中文
  zh: [
    '退出', '退出登录', '登出', '个人中心', '我的', '账号设置',
    '欢迎', '您好', '用户', '会员', '订单', '购物车'
  ],
  // 英文
  en: [
    'logout', 'sign out', 'log out', 'profile', 'my account',
    'settings', 'welcome', 'user', 'member', 'orders', 'cart'
  ]
};

// 平台特定的登录检测
const PLATFORM_SPECIFIC = {
  'douyin.com': {
    loginUrl: 'https://www.douyin.com/login',
    loginIndicators: ['登录后推荐更精准', '登录以享受更多功能'],
    loggedInIndicators: ['消息', '投稿', '创作服务平台']
  },
  'tiktok.com': {
    loginUrl: 'https://www.tiktok.com/login',
    loginIndicators: ['Log in to follow creators', 'Sign up for TikTok'],
    loggedInIndicators: ['Messages', 'Inbox', 'Profile']
  }
};

class LoginDetector {
  constructor() {
    this.lastCheck = null;
    this.cacheTimeout = 5000; // 5秒缓存
  }

  /**
   * 检测页面登录状态
   * @param {Object} pageInfo - 页面信息 { url, title, content }
   * @returns {Object} { needsLogin: boolean, isLoggedIn: boolean, confidence: number, message: string }
   */
  detect(pageInfo) {
    const { url, title, content } = pageInfo;
    
    // 检查缓存
    if (this.lastCheck && Date.now() - this.lastCheck.timestamp < this.cacheTimeout) {
      return this.lastCheck.result;
    }

    const text = `${title || ''} ${content || ''}`.toLowerCase();
    const domain = this._extractDomain(url);

    // 平台特定检测
    const platformCheck = this._checkPlatformSpecific(domain, text);
    if (platformCheck) {
      this.lastCheck = { timestamp: Date.now(), result: platformCheck };
      return platformCheck;
    }

    // 通用检测
    const result = this._genericCheck(text);
    this.lastCheck = { timestamp: Date.now(), result };
    return result;
  }

  /**
   * 检测平台特定登录状态
   */
  _checkPlatformSpecific(domain, text) {
    for (const [platform, config] of Object.entries(PLATFORM_SPECIFIC)) {
      if (domain.includes(platform)) {
        // 检查已登录标识
        for (const indicator of config.loggedInIndicators) {
          if (text.includes(indicator.toLowerCase())) {
            return {
              needsLogin: false,
              isLoggedIn: true,
              confidence: 0.9,
              message: `已登录 ${platform}`,
              platform
            };
          }
        }

        // 检查登录提示
        for (const indicator of config.loginIndicators) {
          if (text.includes(indicator.toLowerCase())) {
            return {
              needsLogin: true,
              isLoggedIn: false,
              confidence: 0.85,
              message: `需要登录 ${platform} 才能继续操作`,
              platform,
              loginUrl: config.loginUrl
            };
          }
        }
      }
    }
    return null;
  }

  /**
   * 通用登录检测
   */
  _genericCheck(text) {
    let loginScore = 0;
    let loggedInScore = 0;
    let totalIndicators = 0;

    // 检测登录关键词
    for (const keywords of [...LOGIN_KEYWORDS.zh, ...LOGIN_KEYWORDS.en]) {
      totalIndicators++;
      if (text.includes(keywords.toLowerCase())) {
        loginScore++;
      }
    }

    // 检测已登录标识
    for (const indicators of [...LOGGED_IN_INDICATORS.zh, ...LOGGED_IN_INDICATORS.en]) {
      if (text.includes(indicators.toLowerCase())) {
        loggedInScore++;
      }
    }

    // 计算置信度
    const loginConfidence = loginScore / Math.max(totalIndicators * 0.3, 3);
    const loggedInConfidence = loggedInScore / 3;

    // 判断结果
    if (loggedInConfidence > 0.5) {
      return {
        needsLogin: false,
        isLoggedIn: true,
        confidence: loggedInConfidence,
        message: '检测到已登录状态'
      };
    }

    if (loginConfidence > 0.4) {
      return {
        needsLogin: true,
        isLoggedIn: false,
        confidence: loginConfidence,
        message: '页面可能需要登录才能继续操作'
      };
    }

    return {
      needsLogin: false,
      isLoggedIn: false,
      confidence: 0,
      message: '无法确定登录状态'
    };
  }

  /**
   * 提取域名
   */
  _extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return '';
    }
  }

  /**
   * 清空缓存
   */
  clearCache() {
    this.lastCheck = null;
  }
}

module.exports = { LoginDetector };
