const $ = (id) => document.getElementById(id);
let widgetId = null;
let token = '';
let submitting = false;
function event(text) {
  const item = document.createElement('li');
  item.textContent = `${new Date().toLocaleTimeString()} · ${text}`;
  $('events').prepend(item);
  while ($('events').children.length > 20) $('events').lastElementChild.remove();
}
function client(text, error = false) {
  $('client-status').textContent = text;
  $('client-status').dataset.error = String(error);
  event(text);
}
function clearToken() {
  token = '';
  $('verify').disabled = true;
}
function resetChallenge() {
  clearToken();
  if (widgetId === null || !window.hcaptcha) return;
  try { window.hcaptcha.reset(widgetId); client('已重置，请重新完成验证码。'); }
  catch { client('重置失败，请刷新页面。', true); }
}
$('reset').addEventListener('click', resetChallenge);
$('challenge-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (submitting || !token) return;
  const submittedToken = token;
  clearToken();
  submitting = true;
  $('reset').disabled = true;
  $('verdict').textContent = '正在请求后端验证…';
  $('verdict').removeAttribute('data-success');
  $('result').textContent = '等待 hCaptcha /siteverify 响应…';
  event('已提交 token；正在等待真实后端结果。');
  try {
    const response = await fetch('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: submittedToken }),
      signal: AbortSignal.timeout(25000),
    });
    const value = await response.json();
    $('result').textContent = JSON.stringify(value, null, 2);
    if (!response.ok) {
      $('verdict').textContent = `接口请求失败（HTTP ${response.status}）`;
      event('本地或上游验证接口异常，查看结果详情。');
    } else if (value.result?.success === true) {
      $('verdict').textContent = 'hCaptcha 后端验证通过';
      $('verdict').dataset.success = 'true';
      event('后端返回 success: true。');
    } else {
      $('verdict').textContent = 'hCaptcha 后端验证未通过';
      $('verdict').dataset.success = 'false';
      event('后端返回 success: false；查看 error-codes，而不是仅凭此推断插件原因。');
    }
  } catch {
    $('verdict').textContent = '验证请求没有取得结果';
    $('result').textContent = '可能是本地请求被扩展阻止、服务器停止或请求超时。请查看浏览器网络面板；这不是 hCaptcha 返回的拒绝结论。';
    event('验证请求异常或超时。');
  } finally {
    submitting = false;
    $('reset').disabled = widgetId === null;
    clearToken();
    if (widgetId !== null) {
      try { window.hcaptcha.reset(widgetId); }
      catch { client('验证码重置失败，请刷新页面。', true); }
    }
    client('本轮提交已结束；如需再次验证，请重新完成挑战。');
  }
});
async function init() {
  const response = await fetch('/config');
  if (!response.ok) throw new Error('本地配置请求失败');
  const config = await response.json();
  $('config-status').textContent = `Sitekey：${config.sitekey}`;
  const timer = setTimeout(() => client('hCaptcha SDK 尚未就绪：检查网络、插件拦截或控制台错误；不是答题失败。', true), 20000);
  window.onloadHCaptcha = () => {
    clearTimeout(timer);
    try {
      widgetId = window.hcaptcha.render('captcha', {
        sitekey: config.sitekey,
        callback(value) {
          if (submitting) return;
          token = value;
          $('verify').disabled = !token;
          client('前端挑战已完成，已收到 token。请点击“提交后端验证”。');
        },
        'error-callback'(code) {
          clearToken();
          client(`hCaptcha 客户端错误：${String(code).slice(0, 180)}`, true);
        },
        'expired-callback'() { clearToken(); client('token 已过期，请重新完成验证码。', true); },
        'chalexpired-callback'() { clearToken(); client('挑战已超时，请重新开始。', true); },
      });
      $('reset').disabled = false;
      client('hCaptcha SDK 已加载，组件已创建。请手动完成挑战。');
    } catch {
      client('hCaptcha 组件初始化失败，请查看控制台和 sitekey 的域名配置。', true);
    }
  };
  const script = document.createElement('script');
  script.src = 'https://js.hcaptcha.com/1/api.js?onload=onloadHCaptcha&render=explicit';
  script.async = true;
  script.defer = true;
  script.onerror = () => {
    clearTimeout(timer);
    client('hCaptcha SDK 加载失败：可能是网络或扩展拦截，请查看网络面板中的 api.js 请求。', true);
  };
  document.head.append(script);
}
init().catch(() => {
  $('config-status').textContent = '本地配置读取失败，请确认服务器仍运行且未被插件拦截。';
  client('本地测试页初始化失败。', true);
});
