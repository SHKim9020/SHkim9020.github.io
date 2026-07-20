(() => {
  'use strict';

  const frame = document.getElementById('editor');
  const statusEl = document.getElementById('status');
  const selectDriveBtn = document.getElementById('selectDrive');
  const pairUsbBtn = document.getElementById('pairUsb');
  const uploadBtn = document.getElementById('upload');
  const restartBtn = document.getElementById('restart');
  const newProjectBtn = document.getElementById('newProject');
  const fullscreenBtn = document.getElementById('fullscreen');
  const notice = document.getElementById('notice');
  const noticeTitle = document.getElementById('noticeTitle');
  const noticeText = document.getElementById('noticeText');
  const noticeClose = document.getElementById('noticeClose');

  const editorOrigin = location.origin;
  let editorReady = false;
  let driveHandle = null;
  let uploadRequested = false;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function showNotice(title, text) {
    noticeTitle.textContent = title;
    noticeText.textContent = text;
    notice.hidden = false;
  }

  function hideNotice() {
    notice.hidden = true;
  }

  function sendEditor(action, extra = {}) {
    if (!frame.contentWindow) throw new Error('편집기 창을 찾을 수 없습니다.');
    const message = {
      type: 'pxteditor',
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      action,
      ...extra,
    };
    frame.contentWindow.postMessage(message, editorOrigin);
    return message.id;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('onemaker-arcade-uploader', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('handles')) {
          req.result.createObjectStore('handles');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveDriveHandle(handle) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, 'microbit');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  async function restoreDriveHandle() {
    try {
      const db = await openDb();
      driveHandle = await new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readonly');
        const req = tx.objectStore('handles').get('microbit');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      db.close();

      if (driveHandle) {
        const permission = await driveHandle.queryPermission({ mode: 'readwrite' });
        if (permission === 'granted') {
          selectDriveBtn.textContent = `✓ ${driveHandle.name} 연결됨`;
          setStatus(`${driveHandle.name} 드라이브 사용 준비 완료`);
        } else {
          selectDriveBtn.textContent = `① ${driveHandle.name} 권한 다시 허용`;
        }
      }
    } catch (error) {
      console.warn('저장된 드라이브 복원 실패', error);
    }
  }

  async function ensureDrivePermission() {
    if (!('showDirectoryPicker' in window)) {
      throw new Error('이 기능은 데스크톱 Chrome 또는 Edge에서 사용할 수 있습니다.');
    }

    if (!driveHandle) {
      driveHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await saveDriveHandle(driveHandle);
    }

    let permission = await driveHandle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      permission = await driveHandle.requestPermission({ mode: 'readwrite' });
    }
    if (permission !== 'granted') {
      throw new Error('MICROBIT 드라이브 쓰기 권한이 허용되지 않았습니다.');
    }

    selectDriveBtn.textContent = `✓ ${driveHandle.name} 연결됨`;
    if (driveHandle.name.toUpperCase() !== 'MICROBIT') {
      showNotice('드라이브 확인', `선택한 폴더 이름이 “${driveHandle.name}”입니다. micro:bit 드라이브가 맞는지 확인해 주세요.`);
    }
    return driveHandle;
  }

  async function writeHexToDrive(download, projectName) {
    const handle = await ensureDrivePermission();
    const safeName = String(projectName || 'arcade-game')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .slice(0, 80) || 'arcade-game';
    const filename = safeName.toLowerCase().endsWith('.hex') ? safeName : `${safeName}.hex`;
    const fileHandle = await handle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(new Blob([download], { type: 'application/octet-stream' }));
    await writable.close();
    return filename;
  }

  function downloadHex(download, projectName) {
    const blob = new Blob([download], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName || 'arcade-game'}.hex`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  frame.addEventListener('load', () => {
    editorReady = true;
    setStatus('편집기 연결 완료 · 프로젝트를 만든 뒤 업로드하세요');
  });

  window.addEventListener('message', async (event) => {
    if (event.source !== frame.contentWindow || event.origin !== editorOrigin) return;
    const message = event.data || {};

    if (message.type === 'pxthost' && message.action === 'workspacesync') {
      message.projects = [];
      frame.contentWindow.postMessage(message, editorOrigin);
      return;
    }

    if (!message.download) return;

    uploadBtn.disabled = true;
    try {
      if (uploadRequested) {
        const filename = await writeHexToDrive(message.download, message.name);
        setStatus(`${filename} 파일을 ${driveHandle.name} 드라이브에 복사했습니다`);
        showNotice('업로드 완료', `“${filename}”을 ${driveHandle.name} 드라이브에 저장했습니다. micro:bit가 자동으로 재시작됩니다.`);
      } else {
        downloadHex(message.download, message.name);
        setStatus('HEX 파일 다운로드 완료');
      }
    } catch (error) {
      console.error(error);
      downloadHex(message.download, message.name);
      setStatus('드라이브 복사 실패 · HEX 다운로드로 전환했습니다');
      showNotice('자동 복사 실패', `${error.message} HEX 파일은 다운로드 폴더에 저장했습니다.`);
    } finally {
      uploadRequested = false;
      uploadBtn.disabled = false;
    }
  });

  selectDriveBtn.addEventListener('click', async () => {
    try {
      await ensureDrivePermission();
      setStatus(`${driveHandle.name} 드라이브 연결 완료`);
    } catch (error) {
      setStatus('드라이브 선택이 취소되었습니다');
      showNotice('연결 실패', error.message);
    }
  });

  pairUsbBtn.addEventListener('click', () => {
    try {
      sendEditor('pair');
      setStatus('USB 장치 선택 창을 확인하세요');
    } catch (error) {
      showNotice('USB 페어링 실패', error.message);
    }
  });

  uploadBtn.addEventListener('click', async () => {
    if (!editorReady) {
      showNotice('편집기 준비 중', '편집기가 완전히 열린 뒤 다시 눌러주세요.');
      return;
    }
    uploadBtn.disabled = true;
    try {
      await ensureDrivePermission();
      uploadRequested = true;
      setStatus('게임을 컴파일하고 있습니다…');
      sendEditor('compile');
    } catch (error) {
      uploadRequested = false;
      uploadBtn.disabled = false;
      setStatus('업로드가 취소되었습니다');
      showNotice('업로드 준비 실패', error.message);
    }
  });

  restartBtn.addEventListener('click', () => sendEditor('restartsimulator'));
  newProjectBtn.addEventListener('click', () => sendEditor('newproject'));
  fullscreenBtn.addEventListener('click', async () => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  });
  noticeClose.addEventListener('click', hideNotice);

  restoreDriveHandle();
  setTimeout(() => {
    if (!editorReady) {
      setStatus('편집기 로딩이 지연되고 있습니다');
      showNotice('로딩 지연', '인터넷 연결을 확인한 뒤 Ctrl+Shift+R로 새로고침해 주세요.');
    }
  }, 25000);
})();
