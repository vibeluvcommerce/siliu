/**
 * PromptBuilder - 提示词构建器
 * 简化版本：让 AI 自主判断每一步操作
 */

// 基础角色定义
const SYSTEM_PREFIX = `你是 Siliu Browser 的 AI Copilot，可以通过 CDP 控制浏览器完成自动化任务。

你的职责：
1. 理解用户的整体目标
2. 自主规划每一步操作
3. 根据执行结果调整策略
4. 确认任务完成后结束
`;

// 操作 Schema（供 AI 参考）
const ACTION_SCHEMA = {
  navigate: { params: ['url'], desc: '导航到指定URL' },
  click: { params: ['selector|target'], desc: '点击元素，支持坐标 {type:"coordinate",x:0.5,y:0.3}' },
  hover: { params: ['selector|target'], desc: '鼠标悬停在元素上（触发下拉菜单、Tooltip等），支持坐标' },
  type: { params: ['selector|target', 'text'], desc: '在输入框输入文本。支持坐标方式：{"action":"type","target":{"type":"coordinate",x:0.5,y:0.3},"text":"xxx"}' },
  upload: { params: ['filePath'], desc: '上传本地文件。只需提供 filePath，系统会自动查找文件输入框并设置文件。示例：{"action":"upload","filePath":"D:/images/photo.jpg"}' },
  select: { params: ['selector', 'option'], desc: '选择下拉框选项（原生select或React Select等自定义下拉），option可以是value、text或index。不需要滚动查找，直接指定选项文本即可' },
  selectAll: { params: ['selector|target'], desc: '全选文本框内容（Ctrl+A），用于复制或替换' },
  press: { params: ['key'], desc: '按键（Enter/Backspace/Delete/Tab/Escape/ArrowDown等）' },
  scroll: { params: ['direction', 'amount'], desc: '滚动页面（普通网页）' },
  wheel: { params: ['direction', 'amount'], desc: '滚轮事件（抖音/视频类网站推荐）' },
  screenshot: { params: [], desc: '截图查看页面状态' },
  wait: { params: ['ms'], desc: '等待一段时间' },
  yes: { params: [], desc: '步骤确认：当前步骤已完成/成功' },
  no: { params: [], desc: '步骤确认：当前步骤失败/需要重试' },
  done: { params: ['summary'], desc: '【最终完成】整个任务全部完成，输出总结' }
};

// 构建操作说明
function buildActionHelp() {
  return Object.entries(ACTION_SCHEMA)
    .map(([name, config]) => `- ${name}: ${config.desc}`)
    .join('\n');
}

class PromptBuilder {
  constructor(options = {}) {
    this.maxSteps = options.maxSteps || 100;
  }

  /**
   * 构建动作模式提示词 - 简化版
   */
  buildActionPrompt(task, observation = null, previousResult = null, stepCount = 0, history = []) {
    // 构建已执行步骤记录
    let executedSteps = '';
    if (history && history.length > 0) {
      executedSteps = history.map((h, i) => {
        // 统一处理不同格式的历史记录
        const action = h.decision?.action || h.action || 'unknown';
        const status = h.confirmStatus === 'yes' ? '✓' : 
                       h.confirmStatus === 'no' ? '✗' : 
                       h.executed ? '○' : '?';
        
        // 提取详细信息
        let detail = '';
        if (h.decision) {
          detail = h.decision.description || h.decision.selector || h.decision.url || '';
        } else {
          detail = h.description || h.selector || h.url || '';
        }
        
        return `${i + 1}. ${action} ${detail} ${status}`;
      }).join('\n');
    }

    // 构建元素列表（增强版）
    let elementsStr = '';
    if (observation?.elements && observation.elements.length > 0) {
      elementsStr = observation.elements.slice(0, 25).map((e, i) => {
        // 构建元素描述
        const parts = [`[${i}] ${e.tag}`];
        
        // 文本内容（优先）
        if (e.text) parts.push(`"${e.text.substring(0, 30)}"`);
        else if (e.placeholder) parts.push(`placeholder:"${e.placeholder.substring(0, 20)}"`);
        else if (e.ariaLabel) parts.push(`aria:"${e.ariaLabel.substring(0, 20)}"`);
        
        // 标识信息
        if (e.id) parts.push(`#${e.id}`);
        else if (e.dataTestId) parts.push(`[data-testid="${e.dataTestId}"]`);
        else if (e.selector && !e.selector.includes('[object')) parts.push(`(${e.selector})`);
        
        // 类型（输入框）
        if (e.type) parts.push(`type:${e.type}`);
        
        // 位置
        parts.push(`at:(${e.rect.x},${e.rect.y})`);
        
        // 相邻元素（用于相对定位）
        if (e.neighbors?.above?.length > 0) {
          const above = e.neighbors.above[0];
          parts.push(`↑${above.tag}"${above.text?.substring(0, 15) || ''}"`);
        }
        if (e.neighbors?.below?.length > 0) {
          const below = e.neighbors.below[0];
          parts.push(`↓${below.tag}"${below.text?.substring(0, 15) || ''}"`);
        }
        
        // 状态
        if (e.disabled) parts.push('[disabled]');
        if (e.cursor === 'pointer') parts.push('[clickable]');
        
        return parts.join(' ');
      }).join('\n');
      
      // 添加元素定位提示
      elementsStr += '\n\n【元素定位指南】';
      elementsStr += '\n- 优先使用元素的索引 [n] 配合 xpath';
      elementsStr += '\n- 或使用完整路径，如: {"xpath": "' + (observation.elements[0]?.xpath || '//button[1]') + '"}';
      elementsStr += '\n- 不确定时可用坐标: {"target": {"type": "coordinate", "x": 0.5, "y": 0.3}}';
      elementsStr += '\n- 相对位置: 通过 ↑ ↓ 标识的相邻元素辅助定位';
    }

    // 构建上一步结果信息
    let previousResultInfo = '';
    if (previousResult) {
      if (previousResult.success) {
        previousResultInfo = '\n【上一步结果】\n执行成功 ✓';
      } else {
        previousResultInfo = '\n【上一步结果】\n执行失败 ✗';
        if (previousResult.error) {
          previousResultInfo += `\n错误: ${previousResult.error}`;
        }
        if (previousResult.message) {
          previousResultInfo += `\n${previousResult.message}`;
        }
        if (previousResult.rawResponse) {
          previousResultInfo += `\n你的原始响应:\n${previousResult.rawResponse.substring(0, 300)}`;
        }
        if (previousResult.decision) {
          previousResultInfo += `\n\n失败的决策:\n${JSON.stringify(previousResult.decision, null, 2)}`;
        }
      }
    }

    return `${SYSTEM_PREFIX}
【任务目标】
${task}

【执行进度】
已完成 ${stepCount} 步
${executedSteps ? '已执行操作:\n' + executedSteps : '（刚开始）'}${previousResultInfo}

【当前页面状态】
URL: ${observation?.url || 'N/A'}
标题: ${observation?.title || 'N/A'}
${observation?.loginStatus?.needsLogin ? `⚠️ 注意: 页面需要登录/扫码/验证码 - 已等待 ${observation?.loginWaitCount || 0} 次` : ''}
${observation?.elements?.length === 0 ? '注意: 页面可能没有完全加载或没有可交互元素' : ''}

【页面元素】（部分）
${elementsStr || '暂无元素信息'}

【可用操作】
${buildActionHelp()}

【执行流程】
1. 分析当前任务：要完成什么？已完成了什么？
2. 判断下一步：需要执行什么操作？
3. 执行操作：输出 navigate/click/type/scroll 等
4. 步骤确认：执行后输出 yes（成功）或 no（失败）
5. 继续循环：直到整个任务完成
6. 最终完成：所有子任务都完成后，输出 done

【重要规则】
- 每执行一步操作后，必须输出 yes 确认成功
- 如果操作失败，输出 no，我会让你重试
- 只有整个任务全部完成，才能使用 done
- 【强制】无论已执行多少步，都不允许自主结束任务
- 禁止提前使用 done 结束任务

【登录和验证码处理】
- 如果页面需要登录/扫码/验证码，使用 wait 操作等待用户完成
- 不要尝试自动输入账号密码或破解验证码
- 等待时间根据已等待次数选择：
  - 第1次等待：wait 20000（20秒）
  - 第2次等待：wait 90000（90秒）
  - 第3次等待：wait 180000（180秒）
- 超过3次仍未登录则结束任务

【输出格式】
执行操作: {"action": "navigate", "url": "google.com", "description": "打开 Google 首页"}
执行操作: {"action": "click", "target": {"type": "coordinate", "x": 0.5, "y": 0.3}, "description": "点击搜索框"}
执行操作: {"action": "hover", "selector": ".dropdown-menu", "description": "悬停显示下拉菜单"}
执行操作: {"action": "hover", "target": {"type": "coordinate", "x": 0.3, "y": 0.2}, "description": "悬停触发Tooltip"}
执行操作: {"action": "select", "selector": "select[name='country']", "option": "China", "description": "选择国家为中国"}
执行操作: {"action": "type", "target": {"type": "coordinate", "x": 0.5, "y": 0.3}, "text": "iPhone", "description": "在搜索框输入iPhone"}
执行操作: {"action": "selectAll", "target": {"type": "coordinate", "x": 0.5, "y": 0.3}, "description": "全选搜索框内容准备替换"}
执行操作: {"action": "upload", "filePath": "D:/images/photo.jpg", "description": "上传本地图片到评论框"}
执行操作: {"action": "press", "key": "Enter", "description": "按回车提交搜索"}
执行操作: {"action": "press", "key": "Backspace", "description": "删除输入错误"}
执行操作: {"action": "scroll", "direction": "down", "amount": 500, "description": "向下滚动页面"}
执行操作: {"action": "wheel", "direction": "down", "amount": 800, "description": "滚轮切换视频"}
执行操作: {"action": "screenshot", "description": "截图查看当前状态"}
执行操作: {"action": "wait", "ms": 1000, "description": "等待页面加载"}
步骤确认: {"action": "yes", "description": "步骤执行成功"} 或 {"action": "no", "description": "步骤执行失败，需要重试"}
最终完成: {"action": "done", "summary": "任务完成总结"}

【强制要求】
- 每个操作必须包含 description 字段，且不能为空
- description 应该清晰描述正在做什么，例如:"点击搜索按钮"、"输入用户名"、"向下滚动"等
- 不允许输出空的 description，这是必填字段

【注意】
- type 操作可以使用 target（坐标）或 selector（CSS选择器）
- 如果不确定选择器，优先使用坐标点击输入框，然后输入文本
- press 支持：Enter（回车）、Backspace（退格删除）、Delete（删除）、Tab（制表）、Escape（退出）、ArrowDown/ArrowUp/ArrowLeft/ArrowRight（方向键）
- selectAll 支持：使用 Ctrl+A 全选文本框内容，配合 type 可替换原有内容
- upload 支持上传本地文件到网页，只需提供 filePath（如 "D:/images/photo.jpg"），系统会自动查找文件输入框并设置文件。注意：不需要先点击上传按钮，直接调用 upload 即可
- 【重要限制】B站评论图片上传目前不支持自动化，因为B站使用自定义上传组件而非标准file input。如遇上传失败，请跳过图片上传直接发布纯文字评论
- 【重要】抖音/视频类网站请使用 wheel 而非 scroll 来切换视频
- 输入错误时可使用 press + Backspace 删除后重新输入，或使用 selectAll 全选后直接输入替换
- 【重要】遇到登录/扫码/验证码时暂停任务，告知用户完成后再继续
- 【重要】选择下拉框选项时，直接使用 select 动作，传入 option 文本（如 "Silver"），系统会自动处理查找和选择，不需要手动滚动查找

【hover后点击下拉菜单的要点 - 强制执行】
- hover 头像/按钮后，下拉菜单通常出现在其下方（y坐标比头像大）
- 【坐标范围】头像通常在 y: 0.04-0.06，下拉菜单项在 y: 0.08-0.15 范围内
- 【关键】B站头像 hover 后，个人中心通常在 y: 0.10-0.12，x: 0.75-0.85
- 【必须】hover 后必须先 screenshot 查看当前状态
- 【必须】根据截图中实际看到的位置点击，如果看不清就再 screenshot
- 【绝对禁止】y > 0.20 的点击肯定错误（下拉菜单不可能那么低）
- 【安全范围】点击下拉菜单项时，y 坐标必须在 0.08-0.18 之间

请分析并输出下一步操作：`;
  }

  /**
   * 构建视觉增强提示词
   */
  buildVisualActionPrompt(task, observation = null, previousResult = null, stepCount = 0, history = []) {
    const basePrompt = this.buildActionPrompt(task, observation, previousResult, stepCount, history);
    
    if (!observation?.screenshot) {
      return { text: basePrompt };
    }

    const visualGuide = `

【截图信息】
尺寸: ${observation.screenshot.width}x${observation.screenshot.height}

【坐标系统 - 重要】
- 所有坐标使用 0-1 的相对坐标（百分比）
- 左上角为 (0, 0)，右下角为 (1, 1)
- 示例：屏幕中央 = {"x": 0.5, "y": 0.5}
- 示例：右上角按钮 = {"x": 0.9, "y": 0.1}

【视觉辅助】
- 结合截图判断元素位置
- 如元素位置明确，可使用坐标点击: {"target": {"type": "coordinate", "x": 0.5, "y": 0.3}}
- 坐标精度：0.1 精度即可（如 0.5, 0.55），不需要精确到 0.01

【智能等待策略】
- 导航后：使用 wait 500-2000ms 等待页面加载
- 点击后：使用 wait 300-500ms 等待页面响应
- 输入后：使用 wait 200ms 等待输入完成
- 滚动后：使用 wait 500ms 等待内容加载
- 不确定时：使用 screenshot 查看当前状态后再继续

请结合截图分析页面状态，输出下一步操作：`;

    return {
      text: basePrompt + visualGuide,
      hasVisual: true
    };
  }

  /**
   * 构建对话模式提示词
   */
  buildChatPrompt(userMessage) {
    return `${SYSTEM_PREFIX}
当前模式: 对话

用户: ${userMessage}

如果需要操作浏览器，请在回复后加上：
@action: 具体操作描述

否则直接回复用户。`;
  }
}

module.exports = { PromptBuilder, ACTION_SCHEMA };
