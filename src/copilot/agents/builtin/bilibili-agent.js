/**
 * BilibiliAgent - Bilibili 专用 Agent
 * 
 * 适用场景：
 * - B站视频播放、评论、投稿
 * - B站用户中心、动态、消息
 * - B站直播相关操作
 * 
 * 特有优化：
 * - 视频控制栏识别
 * - 评论区域定位
 * - Hover 菜单坐标知识
 * - 动态刷新策略
 */

const { BaseAgent } = require('../base-agent');

class BilibiliAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      id: 'bilibili',
      name: 'B站助手',
      icon: 'television',               // Phosphor 图标
      color: '#FB7299',                 // B站粉色渐变
      colorEnd: '#FC9BAD',
      description: '专为 Bilibili 优化的自动化助手',
      ...options
    });
  }

  /**
   * B站特有领域知识
   * 包含 B站 DOM 结构特点和最佳实践
   */
  getDomainKnowledge() {
    return `【B站特有规则】

【首页关键元素坐标 - 已标注】
- 搜索框: 坐标 (0.51, 0.04)，使用 click 聚焦后 type 输入
- 用户头像: 坐标 (0.71, 0.04)，使用 hover 展开下拉菜单
  - hover 后下拉菜单出现在下方，菜单项 y: 0.08-0.15 范围内
  - 个人中心入口约在 (0.71, 0.10-0.12)
- 投稿按钮: 坐标 (0.95, 0.04)，使用 click 进入投稿页
- 首页第一个视频卡片: 坐标 (0.61, 0.40)，使用 click 进入视频页

【视频播放页关键元素 - 已标注】
- 点赞按钮: 坐标 (0.05, 0.79)，在视频下方操作栏左侧
- 评论输入框: placeholder 为 "发一条友善的评论"，可能需要先 scroll 到评论区
- 评论发送按钮: 蓝色 "发送" 文字按钮
- 视频控制栏在底部，包含：播放/暂停、进度条、音量、设置、全屏
- 进度条拖拽：先点击位置，再等待 100ms
- 弹幕输入框在底部，通常有 "发弹幕" placeholder
- 投币/收藏在点赞右侧，使用 click 操作

【Hover 下拉菜单 - 关键知识】
- hover 头像/按钮后，下拉菜单出现在其下方（y坐标比头像大）
- 【坐标范围】头像通常在 y: 0.04-0.06，下拉菜单项在 y: 0.08-0.15 范围内
- 【关键】B站头像 hover 后，个人中心通常在 y: 0.10-0.12，x: 0.71-0.75
- 【必须】hover 后必须先 screenshot 查看当前状态
- 【必须】根据截图中实际看到的位置点击，如果看不清就再 screenshot
- 【绝对禁止】y > 0.20 的点击肯定错误（下拉菜单不可能那么低）
- 【安全范围】点击下拉菜单项时，y 坐标必须在 0.08-0.18 之间

【创作中心/投稿页 - 已标注】
- 上传视频按钮: 坐标 (0.65, 0.77)，click 后使用 upload 操作选择文件
- 标题输入框: 需要 click 聚焦后 type 输入标题（页面滚动后位置会变）
- 分区选择框: 级联选择器，先 click 展开，然后 click 大类（如"生活"），再 click 子类
- 立即投稿按钮: 坐标 (0.48, 0.92)，在页面底部，完成填写后 click 提交
- 分P视频需要点击 "添加视频"
- 标签输入需要按 Enter 确认

【评论区】
- 评论输入框有 placeholder "发一条友善的评论"
- 评论发送按钮通常是蓝色 "发送" 文字
- 回复评论需要点击 "回复" 链接

【动态页面】
- 动态列表需要向下滚动加载更多
- 动态中的视频点击后会跳转播放页
- 转发动态需要先点击 "转发" 按钮

【投稿相关通用建议】
- 上传视频必须使用 upload 操作，系统会自动打开文件选择对话框
- 分区选择是级联选择器：先点击分区下拉展开，然后点击大类（如"生活"），再点击子类（如"日常"）
- 不要使用 select 操作，使用两次 click：先点击坐标展开下拉，再点击选项文字

【通用建议】
- B站页面有较多动态加载内容，操作前建议先 wait 500ms
- 视频相关操作优先使用坐标，因为 DOM 结构复杂
- 遇到登录弹窗立即停止，等待用户处理`;
  }

  /**
   * 优化元素格式化，突出 B站特有元素
   */
  formatElements(elements) {
    // 先调用父类方法获取基础格式
    let result = super.formatElements(elements);
    
    // 添加 B站元素识别提示
    const hasVideo = elements.some(e => 
      e.tag === 'video' || 
      e.className?.includes('player') ||
      e.className?.includes('video')
    );
    
    const hasDanmaku = elements.some(e =>
      e.className?.includes('danmaku') ||
      e.placeholder?.includes('弹幕')
    );

    if (hasVideo || hasDanmaku) {
      result += '\n\n【B站元素识别】';
      if (hasVideo) result += '\n- 检测到视频播放器，可使用坐标点击控制栏';
      if (hasDanmaku) result += '\n- 检测到弹幕输入框，位于页面底部';
    }

    return result;
  }

  /**
   * 预处理观察数据，优化 B站元素提取
   */
  processObservation(observation) {
    if (!observation.elements) return observation;

    // 识别 B站特有元素并标记
    observation.elements = observation.elements.map(el => {
      const enhanced = { ...el };
      
      // 识别视频控制相关
      if (el.className?.includes('bpx-player') || 
          el.className?.includes('video-player')) {
        enhanced.isVideoControl = true;
        enhanced.priority = (enhanced.priority || 0) + 1;
      }
      
      // 识别评论区
      if (el.className?.includes('reply-item') ||
          el.className?.includes('comment')) {
        enhanced.isComment = true;
      }
      
      // 识别弹幕输入
      if (el.placeholder?.includes('弹幕') ||
          el.className?.includes('danmaku')) {
        enhanced.isDanmakuInput = true;
        enhanced.priority = (enhanced.priority || 0) + 2;
      }
      
      return enhanced;
    });

    // 按优先级排序
    observation.elements.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    return observation;
  }
}

module.exports = { BilibiliAgent };
