const fs=require('fs'),assert=require('assert');const html=fs.readFileSync(__dirname+'/../index.html','utf8'),js=fs.readFileSync(__dirname+'/../app.js','utf8'),ino=fs.readFileSync(__dirname+'/../firmware/rc_cam_runtime/rc_cam_runtime.ino','utf8');
for(const id of ['blocklyDiv','firmwareBtn','connectBtn','uploadBtn','carNumber','openRemoteBtn','copyBtn','pasteBtn','deleteBtn','centerBtn','sideCollapseBtn','pwaInstallBtn','testFlashOnBtn'])assert(html.includes(`id="${id}"`),`missing ${id}`);
for(const block of ['event_start','event_forever','remote_when','car_drive','motor_pair','camera_flash'])assert(js.includes(`type:"${block}"`),`missing block ${block}`);
for(const safety of ['REMOTE_WATCHDOG_MS','pagehide','visibilitychange'])assert(js.includes(safety)||ino.includes(safety),`missing safety ${safety}`);
assert(ino.includes('OneMaker-RC-'));assert(ino.includes('streamHandler'));assert(ino.includes('GPIO_NUM 32'));assert(ino.includes('cmd=="cameraFrame"'));
for(const file of ['bootloader.bin','partitions.bin','boot_app0.bin','rc_cam_runtime-0.1.0.part1.bin','rc_cam_runtime-0.1.0.part2.bin'])assert(fs.existsSync(__dirname+'/../firmware/'+file),`missing firmware ${file}`);
console.log('ESP32-CAM RC Studio static tests passed');
