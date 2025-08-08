// グローバル変数
let mode = 'draw';
let brushColor = '#FF6B6B';
let brushSize = 5;
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let particles = [];
let animationId = null;
let isBlurEnabled = true;

// キャンバス要素
const drawingCanvas = document.getElementById('drawingCanvas');
const handCanvas = document.getElementById('handCanvas');
const segmentationCanvas = document.getElementById('segmentationCanvas');
const drawingCtx = drawingCanvas.getContext('2d');
const handCtx = handCanvas.getContext('2d');
const segmentationCtx = segmentationCanvas.getContext('2d');
const video = document.getElementById('inputVideo');

// ステータス要素
const cameraStatus = document.getElementById('cameraStatus');
const handStatus = document.getElementById('handStatus');
const gestureStatus = document.getElementById('gestureStatus');

// キャンバスサイズ設定
function resizeCanvas() {
    const container = document.querySelector('.canvas-container');
    const rect = container.getBoundingClientRect();
    
    drawingCanvas.width = rect.width;
    drawingCanvas.height = rect.height;
    handCanvas.width = rect.width;
    handCanvas.height = rect.height;
    
    // セグメンテーション用キャンバスは小さいサイズ
    segmentationCanvas.width = 200;
    segmentationCanvas.height = 150;
    
    // 背景を白に
    drawingCtx.fillStyle = 'white';
    drawingCtx.fillRect(0, 0, drawingCanvas.width, drawingCanvas.height);
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
        const x = (1 - indexTip.x) * drawingCanvas.width;
        const y = indexTip.y * drawingCanvas.height;
        
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
    
    // 人差し指が立っている
    const indexUp = landmarks[8].y < landmarks[6].y;
    // 中指が立っている
    const middleUp = landmarks[12].y < landmarks[10].y;
    // 親指と人差し指の距離
    const pinchDistance = Math.sqrt(
        Math.pow(thumb.x - index.x, 2) + 
        Math.pow(thumb.y - index.y, 2)
    );
    
    if (pinchDistance < 0.08) {
        return 'ピンチ';
    } else if (indexUp && !middleUp) {
        return 'ポイント';
    } else if (indexUp && middleUp) {
        return 'ピース';
    } else if (!indexUp && !middleUp) {
        return 'グー';
    } else {
        return 'パー';
    }
}

// 描画モード処理
function handleDrawMode(x, y, gesture) {
    if (gesture === 'ポイント') {
        if (!isDrawing) {
            isDrawing = true;
            drawingCtx.beginPath();
            drawingCtx.moveTo(x, y);
        } else {
            drawingCtx.lineTo(x, y);
            drawingCtx.strokeStyle = brushColor;
            drawingCtx.lineWidth = brushSize;
            drawingCtx.lineCap = 'round';
            drawingCtx.stroke();
        }
    } else {
        isDrawing = false;
    }
}

// パーティクルモード処理
function handleParticleMode(x, y, gesture) {
    if (gesture === 'ポイント' || gesture === 'パー') {
        // パーティクル生成
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

// カメラ初期化
const camera = new Camera(video, {
    onFrame: async () => {
        await hands.send({image: video});
        await selfieSegmentation.send({image: video});
    },
    width: 1280,
    height: 720
});

// カメラ開始
camera.start().then(() => {
    cameraStatus.textContent = '動作中';
    cameraStatus.classList.add('active');
}).catch((err) => {
    console.error('カメラエラー:', err);
    cameraStatus.textContent = 'エラー';
});

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
});

// 保存ボタン
document.getElementById('saveBtn').addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = `hand-art-${Date.now()}.png`;
    link.href = drawingCanvas.toDataURL();
    link.click();
});


// ウィンドウリサイズ対応
window.addEventListener('resize', resizeCanvas);

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

// 初期化
window.addEventListener('load', () => {
    resizeCanvas();
});