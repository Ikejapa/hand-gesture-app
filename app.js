// グローバル変数
let mode = 'draw';
let brushColor = '#F15C5C';
let brushSize = 5;
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let particles = [];
let animationId = null;
let isBlurEnabled = true;

// Undo機能用の変数
let drawingHistory = [];
let historyStep = -1;
const MAX_HISTORY = 50; // 最大履歴数

// 線を滑らかにするための座標履歴
let coordinateHistory = [];
const HISTORY_SIZE = 5;  // 履歴のサイズ（大きいほど滑らか）

// キャンバス要素
const drawingCanvas = document.getElementById('drawingCanvas');
const handCanvas = document.getElementById('handCanvas');
const segmentationCanvas = document.getElementById('segmentationCanvas');
const drawingCtx = drawingCanvas.getContext('2d');
const handCtx = handCanvas.getContext('2d');
const segmentationCtx = segmentationCanvas.getContext('2d');
const video = document.getElementById('inputVideo');

// ステータス要素（ヘッダーのみ）
const cameraStatus = document.getElementById('headerCameraStatus');
const handStatus = document.getElementById('headerHandStatus');
const gestureStatus = document.getElementById('headerGestureStatus');

// 座標を平滑化する関数
function smoothCoordinate(x, y) {
    // 座標を履歴に追加
    coordinateHistory.push({ x, y });
    
    // 履歴サイズを制限
    if (coordinateHistory.length > HISTORY_SIZE) {
        coordinateHistory.shift();
    }
    
    // 移動平均を計算
    if (coordinateHistory.length === 0) return { x, y };
    
    let avgX = 0;
    let avgY = 0;
    let totalWeight = 0;
    
    // 重み付き移動平均（新しい座標ほど重みを大きく）
    coordinateHistory.forEach((coord, index) => {
        const weight = index + 1;  // 1, 2, 3, 4, 5...
        avgX += coord.x * weight;
        avgY += coord.y * weight;
        totalWeight += weight;
    });
    
    return {
        x: avgX / totalWeight,
        y: avgY / totalWeight
    };
}

// 描画履歴を保存する関数
function saveDrawingState() {
    historyStep++;
    if (historyStep < drawingHistory.length) {
        drawingHistory.length = historyStep;
    }
    drawingHistory.push(drawingCanvas.toDataURL());
    
    // 履歴の上限を管理
    if (drawingHistory.length > MAX_HISTORY) {
        drawingHistory.shift();
        historyStep = MAX_HISTORY - 1;
    }
}

// Undo機能
function undoDrawing() {
    if (historyStep > 0) {
        historyStep--;
        restoreDrawingState();
    }
}

// Redo機能
function redoDrawing() {
    if (historyStep < drawingHistory.length - 1) {
        historyStep++;
        restoreDrawingState();
    }
}

// 描画状態を復元する関数
function restoreDrawingState() {
    const img = new Image();
    img.onload = function() {
        drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
        drawingCtx.drawImage(img, 0, 0);
    };
    img.src = drawingHistory[historyStep];
}

// キャンバスサイズ設定（描画保持版）
function resizeCanvas() {
    const container = document.querySelector('.canvas-container');
    const rect = container.getBoundingClientRect();
    
    // 現在の描画内容を保存（リサイズ前）
    const currentDrawing = drawingCanvas.toDataURL();
    
    // 新しいサイズを設定
    const newWidth = rect.width;
    const newHeight = rect.height;
    
    // サイズが変わっていない場合は何もしない（描画保持のため）
    if (drawingCanvas.width === newWidth && drawingCanvas.height === newHeight) {
        return;
    }
    
    drawingCanvas.width = newWidth;
    drawingCanvas.height = newHeight;
    handCanvas.width = newWidth;
    handCanvas.height = newHeight;
    
    // セグメンテーション用キャンバスは小さいサイズ
    segmentationCanvas.width = 200;
    segmentationCanvas.height = 150;
    
    // 背景を白に
    drawingCtx.fillStyle = 'white';
    drawingCtx.fillRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    
    // 保存した描画内容を復元
    if (currentDrawing && currentDrawing !== 'data:,') {
        const img = new Image();
        img.onload = function() {
            drawingCtx.drawImage(img, 0, 0);
            // 復元後に履歴を保存
            saveDrawingState();
        };
        img.src = currentDrawing;
    } else {
        // 初期状態を履歴に保存
        saveDrawingState();
    }
}

// MediaPipe Hands初期化
const hands = new Hands({
    locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    }
});

hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});

// MediaPipe SelfieSegmentation初期化
const selfieSegmentation = new SelfieSegmentation({
    locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`;
    }
});

selfieSegmentation.setOptions({
    modelSelection: 1,
});

// セグメンテーション結果処理
selfieSegmentation.onResults(onSegmentationResults);

// 手の検出結果処理
hands.onResults(onResults);

// セグメンテーション結果処理関数
function onSegmentationResults(results) {
    segmentationCtx.save();
    segmentationCtx.clearRect(0, 0, segmentationCanvas.width, segmentationCanvas.height);
    
    if (isBlurEnabled) {
        // ぼかし有効：全体をぼかして表示
        segmentationCtx.filter = 'blur(10px)';
        segmentationCtx.drawImage(results.image, 0, 0, segmentationCanvas.width, segmentationCanvas.height);
        segmentationCtx.filter = 'none';
    } else {
        // ぼかし無効：元画像をそのまま表示
        segmentationCtx.drawImage(results.image, 0, 0, segmentationCanvas.width, segmentationCanvas.height);
    }
    
    segmentationCtx.restore();
}

function onResults(results) {
    // 手のキャンバスをクリア
    handCtx.save();
    handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
    
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        
        // 手のステータス更新
        handStatus.textContent = '検出中';
        handStatus.classList.add('active');
        
        // 人差し指の先端（landmark 8）を取得
        const indexTip = landmarks[8];
        // X座標を反転させて鏡のような動きにする
        const rawX = (1 - indexTip.x) * drawingCanvas.width;
        const rawY = indexTip.y * drawingCanvas.height;
        
        // 座標を平滑化
        const smoothed = smoothCoordinate(rawX, rawY);
        const x = smoothed.x;
        const y = smoothed.y;
        
        // ジェスチャー検出
        const gesture = detectGesture(landmarks);
        gestureStatus.textContent = gesture;
        
        // モードに応じた処理
        if (mode === 'draw') {
            handleDrawMode(x, y, gesture);
        } else if (mode === 'particle') {
            handleParticleMode(x, y, gesture);
        }
        
        // 手の骨格を描画（X座標を反転）
        const flippedLandmarks = landmarks.map(landmark => ({
            x: 1 - landmark.x,
            y: landmark.y,
            z: landmark.z
        }));
        drawConnectors(handCtx, flippedLandmarks, HAND_CONNECTIONS, 
            {color: '#00FF00', lineWidth: 2});
        drawLandmarks(handCtx, flippedLandmarks, 
            {color: '#FF0000', lineWidth: 1, radius: 3});
        
        // カーソル位置にインジケーター表示
        handCtx.beginPath();
        handCtx.arc(x, y, 10, 0, 2 * Math.PI);
        handCtx.strokeStyle = brushColor;
        handCtx.lineWidth = 3;
        handCtx.stroke();
        
        lastX = x;
        lastY = y;
    } else {
        handStatus.textContent = '未検出';
        handStatus.classList.remove('active');
        gestureStatus.textContent = 'なし';
        isDrawing = false;
        coordinateHistory = [];  // 手を検出できない時は履歴をクリア
    }
    
    handCtx.restore();
}

// ジェスチャー検出
function detectGesture(landmarks) {
    const thumb = landmarks[4];
    const index = landmarks[8];
    const middle = landmarks[12];
    const ring = landmarks[16];
    const pinky = landmarks[20];
    
    // 各指が立っているかの判定
    const thumbUp = landmarks[4].x > landmarks[3].x; // 親指（横方向で判定）
    const indexUp = landmarks[8].y < landmarks[6].y; // 人差し指
    const middleUp = landmarks[12].y < landmarks[10].y; // 中指
    const ringUp = landmarks[16].y < landmarks[14].y; // 薬指
    const pinkyUp = landmarks[20].y < landmarks[18].y; // 小指
    
    // 親指と人差し指の距離（ピンチ判定用）
    const pinchDistance = Math.sqrt(
        Math.pow(thumb.x - index.x, 2) + 
        Math.pow(thumb.y - index.y, 2)
    );
    
    // 立っている指の数をカウント
    const fingersUp = [thumbUp, indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;
    
    if (pinchDistance < 0.08) {
        return 'ピンチ';
    } else if (fingersUp >= 4) {
        return 'パー'; // 4本以上立っていればパー
    } else if (indexUp && middleUp && !ringUp && !pinkyUp) {
        return 'ピース'; // 人差し指と中指のみ
    } else if (indexUp && !middleUp && !ringUp && !pinkyUp) {
        return 'ポイント'; // 人差し指のみ
    } else if (fingersUp <= 1) {
        return 'グー'; // 1本以下ならグー
    } else {
        return 'その他';
    }
}

// パスの履歴を保持
let currentPath = [];
let SMOOTH_THRESHOLD = 2; // 座標間の最小距離

// 描画モード処理
function handleDrawMode(x, y, gesture) {
    if (gesture === 'ポイント') {
        if (!isDrawing) {
            isDrawing = true;
            currentPath = [{x, y}];
            lastX = x;
            lastY = y;
            coordinateHistory = [];
        } else {
            // 移動距離が閾値以上の場合のみ追加
            const distance = Math.sqrt(Math.pow(x - lastX, 2) + Math.pow(y - lastY, 2));
            
            if (distance > SMOOTH_THRESHOLD) {
                currentPath.push({x, y});
                
                // 描画設定
                drawingCtx.strokeStyle = brushColor;
                drawingCtx.lineWidth = brushSize;
                drawingCtx.lineCap = 'round';
                drawingCtx.lineJoin = 'round';
                drawingCtx.globalCompositeOperation = 'source-over';
                
                // パス全体を再描画（最後の数点のみ）
                if (currentPath.length >= 2) {
                    drawingCtx.beginPath();
                    
                    // 最後の数点だけ描画して高速化
                    const startIndex = Math.max(0, currentPath.length - 3);
                    drawingCtx.moveTo(currentPath[startIndex].x, currentPath[startIndex].y);
                    
                    for (let i = startIndex + 1; i < currentPath.length; i++) {
                        const prev = currentPath[i - 1];
                        const curr = currentPath[i];
                        
                        // 中間点を使った曲線補間
                        const midX = (prev.x + curr.x) / 2;
                        const midY = (prev.y + curr.y) / 2;
                        
                        if (i === startIndex + 1) {
                            drawingCtx.lineTo(midX, midY);
                        } else {
                            drawingCtx.quadraticCurveTo(prev.x, prev.y, midX, midY);
                        }
                    }
                    
                    // 最後の点まで線を引く
                    const lastPoint = currentPath[currentPath.length - 1];
                    drawingCtx.lineTo(lastPoint.x, lastPoint.y);
                    drawingCtx.stroke();
                }
                
                lastX = x;
                lastY = y;
                
                // パスが長くなりすぎないように制限
                if (currentPath.length > 100) {
                    currentPath = currentPath.slice(-50);
                }
            }
        }
    } else {
        if (isDrawing) {
            // 描画終了時に最後のパスを確定し、履歴を保存
            isDrawing = false;
            currentPath = [];
            coordinateHistory = [];
            saveDrawingState();
        }
    }
}

// パーティクルモード処理
function handleParticleMode(x, y, gesture) {
    if (gesture === 'ポイント') {
        // パーティクル生成（ポイントの時のみ）
        for (let i = 0; i < 5; i++) {
            particles.push({
                x: x,
                y: y,
                vx: (Math.random() - 0.5) * 10,
                vy: (Math.random() - 0.5) * 10,
                size: Math.random() * 20 + 5,
                color: brushColor,
                life: 1.0
            });
        }
    }
    
    // パーティクル更新と描画
    particles = particles.filter(p => p.life > 0.01);
    
    particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.5; // 重力
        p.life -= 0.02;
        
        // life値を0以上に制限
        const normalizedLife = Math.max(0, p.life);
        
        // 浮動小数点精度エラー対策: epsilonを使用した堅牢な半径計算
        const epsilon = 0.000001;
        let radius = p.size * normalizedLife;
        
        // 半径の検証と修正
        if (!isFinite(radius) || radius < epsilon) {
            radius = 0.1;
        } else {
            // 絶対値を取り、最小値を保証
            radius = Math.max(0.1, Math.abs(radius));
        }
        
        // アルファ値も同様に処理
        const alpha = Math.max(0, Math.min(1, normalizedLife));
        
        drawingCtx.globalAlpha = alpha;
        drawingCtx.fillStyle = p.color;
        drawingCtx.beginPath();
        drawingCtx.arc(p.x, p.y, radius, 0, 2 * Math.PI);
        drawingCtx.fill();
    });
    
    drawingCtx.globalAlpha = 1.0;
}

// iOS検出
function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// カメラ初期化（iOS対応）
let cameraConfig = {
    onFrame: async () => {
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            await hands.send({image: video});
            // iOSではセグメンテーションをスキップ（パフォーマンス対策）
            if (!isIOS() || !isBlurEnabled) {
                await selfieSegmentation.send({image: video});
            }
        }
    }
};

// iOS向けに解像度を調整
if (isIOS()) {
    cameraConfig.width = 640;
    cameraConfig.height = 480;
} else {
    cameraConfig.width = 1280;
    cameraConfig.height = 720;
}

const camera = new Camera(video, cameraConfig);

// HTTPS接続の確認
function checkHTTPS() {
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        alert('カメラを使用するにはHTTPS接続が必要です。https://でアクセスしてください。');
        return false;
    }
    return true;
}

// getUserMedia サポート確認
function checkMediaDevicesSupport() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('このブラウザはカメラアクセスをサポートしていません。\n最新版のChrome、Firefox、Safariをお使いください。');
        return false;
    }
    return true;
}

// カメラ開始（iOS対応改善）
async function startCamera() {
    try {
        // iOSの場合、video要素に追加属性を設定
        if (isIOS()) {
            video.setAttribute('playsinline', '');
            video.setAttribute('autoplay', '');
            video.setAttribute('muted', '');
        }
        
        await camera.start();
        cameraStatus.textContent = '動作中';
        cameraStatus.classList.add('active');
        
        // iOSの場合、初期化後に少し待機
        if (isIOS()) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    } catch (err) {
        console.error('カメラエラー:', err);
        let errorMessage = 'カメラエラー';
        
        if (err.name === 'NotAllowedError') {
            errorMessage = 'カメラ許可が必要です';
            if (isIOS()) {
                alert('カメラの使用を許可してください。\n設定 > Safari > カメラでアクセスを許可してから、ページを再読み込みしてください。');
            } else {
                alert('カメラの使用を許可してください。ブラウザの設定でカメラアクセスを有効にしてから、ページを再読み込みしてください。');
            }
        } else if (err.name === 'NotFoundError') {
            errorMessage = 'カメラが見つかりません';
        } else if (err.name === 'NotSupportedError' || err.name === 'NotReadableError') {
            errorMessage = 'カメラアクセスエラー';
            if (isIOS()) {
                alert('カメラへのアクセスに失敗しました。\n他のアプリがカメラを使用していないか確認し、ページを再読み込みしてください。');
            } else {
                alert('カメラを使用するにはHTTPS接続が必要です。');
            }
        } else if (err.name === 'OverconstrainedError') {
            errorMessage = '解像度エラー';
            alert('カメラの解像度設定に問題があります。ページを再読み込みしてください。');
        }
        
        cameraStatus.textContent = errorMessage;
    }
}

// 手動カメラ開始機能（iOS用）
window.manualStartCamera = async function() {
    const button = document.getElementById('startCameraButton');
    if (button) {
        button.style.display = 'none';
    }
    await startCamera();
};

// カメラ開始
if (checkHTTPS() && checkMediaDevicesSupport()) {
    // iOS Safariの場合、ユーザー操作を促す
    if (isIOS()) {
        // 自動開始を試みる
        window.addEventListener('load', () => {
            setTimeout(async () => {
                try {
                    await startCamera();
                } catch (err) {
                    // 自動開始に失敗した場合、手動開始ボタンを表示
                    console.log('自動カメラ開始に失敗。手動開始ボタンを表示します。');
                    const button = document.getElementById('startCameraButton');
                    if (button) {
                        button.style.display = 'block';
                    }
                    cameraStatus.textContent = 'ボタンをタップ';
                }
            }, 100);
        });
    } else {
        startCamera();
    }
} else {
    cameraStatus.textContent = 'HTTPS必須';
}

// モード切り替え
document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        mode = btn.dataset.mode;
        
        // 前のアニメーションを停止
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        
        if (mode === 'particle') {
            // パーティクルモード用のアニメーションループ開始
            animateParticles();
        }
    });
});

// パーティクルアニメーション
function animateParticles() {
    if (mode === 'particle') {
        // 少しずつフェードアウト
        drawingCtx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        drawingCtx.fillRect(0, 0, drawingCanvas.width, drawingCanvas.height);
        animationId = requestAnimationFrame(animateParticles);
    } else {
        // モードが変わったらアニメーション停止
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
    }
}

// 色選択
document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        brushColor = btn.dataset.color;
    });
});

// ブラシサイズ変更
document.getElementById('brushSize').addEventListener('input', (e) => {
    brushSize = e.target.value;
    document.getElementById('sizeValue').textContent = brushSize;
});

// クリアボタン
document.getElementById('clearBtn').addEventListener('click', () => {
    drawingCtx.fillStyle = 'white';
    drawingCtx.fillRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    particles = [];
    
    // アニメーションも停止
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    
    // クリア後の状態を履歴に保存
    saveDrawingState();
});

// 保存ボタン
document.getElementById('saveBtn').addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = `hand-art-${Date.now()}.png`;
    link.href = drawingCanvas.toDataURL();
    link.click();
});


// リサイズ処理のデバウンス（モバイル対策）
let resizeTimeout = null;
function debouncedResize() {
    if (resizeTimeout) {
        clearTimeout(resizeTimeout);
    }
    resizeTimeout = setTimeout(() => {
        resizeCanvas();
    }, 150); // 150ms待機してからリサイズ実行
}

// ウィンドウリサイズ対応（デバウンス付き）
window.addEventListener('resize', debouncedResize);

// モバイル向け：orientationchange対応
window.addEventListener('orientationchange', () => {
    // 画面回転後、少し待ってからリサイズ
    setTimeout(() => {
        resizeCanvas();
    }, 500);
});

// ぼかしON/OFFボタン
document.getElementById('blurToggleBtn').addEventListener('click', () => {
    isBlurEnabled = !isBlurEnabled;
    const toggleText = document.getElementById('blurToggleText');
    const toggleBtn = document.getElementById('blurToggleBtn');
    
    if (isBlurEnabled) {
        toggleText.textContent = 'ぼかし OFF';
        toggleBtn.style.background = 'linear-gradient(135deg, #00BFFF 0%, #1E90FF 100%)';
        toggleBtn.style.color = 'white';
    } else {
        toggleText.textContent = 'ぼかし ON';
        toggleBtn.style.background = '';
        toggleBtn.style.color = '';
    }
});

// キーボードショートカット
document.addEventListener('keydown', (e) => {
    // Ctrl+Z: Undo
    if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoDrawing();
    }
    // Ctrl+Shift+Z または Ctrl+Y: Redo
    else if ((e.ctrlKey && e.shiftKey && e.key === 'Z') || (e.ctrlKey && e.key === 'y')) {
        e.preventDefault();
        redoDrawing();
    }
});

// Undoボタンのイベントリスナー
document.getElementById('undoBtn').addEventListener('click', () => {
    undoDrawing();
});

// Redoボタンのイベントリスナー
document.getElementById('redoBtn').addEventListener('click', () => {
    redoDrawing();
});

// 初期化
window.addEventListener('load', () => {
    resizeCanvas();
});