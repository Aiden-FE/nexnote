/* eslint-disable */
(function () {
  'use strict';
  var API_VERSION = '1.0.0';
  var seq = 0,
    hostPort = null,
    pending = new Map(),
    initialized = false;
  var lifecycle = [];

  function reportCrash(error) {
    var message = error && error.message ? error.message : String(error || 'Plugin crashed');
    parent.postMessage({ type: 'crash', message: message.slice(0, 500) }, '*');
  }
  window.onerror = function (_msg, _url, _line, _column, error) {
    reportCrash(error || _msg);
    return true;
  };
  window.onunhandledrejection = function (event) {
    reportCrash(event.reason);
  };

  function rpc(method, params) {
    return new Promise(function (resolve, reject) {
      if (!hostPort) return reject(new Error('插件运行时尚未初始化'));
      var id = 'rpc-' + ++seq;
      pending.set(id, { resolve: resolve, reject: reject });
      hostPort.postMessage({
        type: 'rpc',
        request: { apiVersion: API_VERSION, id: id, method: method, params: params },
      });
      setTimeout(function () {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error('RPC 超时'));
        }
      }, 5000);
    });
  }

  function dispatchLifecycle(hook) {
    try {
      window.dispatchEvent(new CustomEvent('nexnote-plugin-' + hook));
    } catch (error) {
      reportCrash(error);
    }
  }

  // 拒绝父窗口以外的 init；一次性 nonce 由宿主 beginSession 校验。
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    if (!event.data || event.data.type !== 'init') return;
    if (initialized) return; // 一次性 init
    if (!event.ports || !event.ports[0]) return;
    initialized = true;
    hostPort = event.ports[0];
    hostPort.onmessage = function (e) {
      var msg = e.data;
      if (!msg) return;
      if (msg.type === 'lifecycle') {
        dispatchLifecycle(msg.hook);
        hostPort.postMessage({ type: 'lifecycle-complete', hook: msg.hook });
        return;
      }
      if (msg.type !== 'rpc-response') return;
      var waiter = pending.get(msg.response.id);
      if (!waiter) return;
      pending.delete(msg.response.id);
      msg.response.ok
        ? waiter.resolve(msg.response.data)
        : waiter.reject(new Error(msg.response.error.message));
    };
    window.nexnotePlugin = {
      apiVersion: API_VERSION,
      registerCommand: function (id, title, keywords) {
        return rpc('command.register', { id: id, title: title, keywords: keywords });
      },
      transact: function (intent, expectedRevision) {
        return rpc('transact', { intent: intent, expectedRevision: expectedRevision });
      },
      requestPermission: function (permission) {
        return rpc('permission.request', { permission: permission });
      },
      callCapability: function (permission, operation, payload) {
        return rpc('capability.call', {
          permission: permission,
          operation: operation,
          payload: payload,
        });
      },
    };
    var script = document.createElement('script');
    var blob = new Blob([String(event.data.source || '')], { type: 'text/javascript' });
    var blobUrl = URL.createObjectURL(blob);
    script.src = blobUrl;
    script.onload = function () {
      URL.revokeObjectURL(blobUrl);
      dispatchLifecycle('initialize');
      dispatchLifecycle('activate');
      dispatchLifecycle('ready');
      parent.postMessage({ type: 'runtime-ready', pluginId: event.data.pluginId }, '*');
    };
    script.onerror = function () {
      URL.revokeObjectURL(blobUrl);
      reportCrash('插件入口加载失败');
    };
    document.body.appendChild(script);
    // 心跳：证明主线程仍在可调度事件循环；宿主 watchdog 超时即转 crashed
    setInterval(function () {
      parent.postMessage({ type: 'heartbeat' }, '*');
    }, 500);
  });
  // 握手重试，等待宿主 frame 挂载好监听
  var readyTimer = setInterval(function () {
    parent.postMessage({ type: 'ready' }, '*');
  }, 100);
  setTimeout(function () {
    clearInterval(readyTimer);
  }, 4_000);
})();
