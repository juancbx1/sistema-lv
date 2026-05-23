// public/src/utils/confetes.js

export function dispararConfetes() {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const particulas = Array.from({ length: 200 }, () => ({
        x: Math.random() * canvas.width,
        y: -20,
        r: 4 + Math.random() * 6,
        d: 2 + Math.random() * 3,
        color: ['#FAC775', '#9FE1CB', '#378ADD', '#E24B4A', '#1D9E75'][Math.floor(Math.random() * 5)],
        tilt: Math.random() * 10 - 5,
        tiltSpeed: 0.05 + Math.random() * 0.1,
        tiltAngle: 0,
    }));
    let frame = 0;
    const duracaoFrames = 180;
    function animar() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particulas.forEach(p => {
            p.y += p.d;
            p.tiltAngle += p.tiltSpeed;
            p.tilt = Math.sin(p.tiltAngle) * 12;
            ctx.beginPath();
            ctx.ellipse(p.x + p.tilt, p.y, p.r * 0.6, p.r, 0, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();
        });
        frame++;
        if (frame < duracaoFrames) requestAnimationFrame(animar);
        else canvas.remove();
    }
    requestAnimationFrame(animar);
}

export function dispararToastVitoria(nomeGincana) {
    const toast = document.createElement('div');
    toast.className = 'ds-toast-vitoria';
    toast.innerHTML = `
        <span class="ds-toast-vitoria-icone">🏆</span>
        <div>
            <p class="ds-toast-vitoria-titulo">Você venceu!</p>
            <p class="ds-toast-vitoria-subtitulo">${nomeGincana}</p>
        </div>
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('ds-toast-vitoria--saindo'), 4500);
    setTimeout(() => toast.remove(), 5200);
}

export function dispararCelebracao(gincana) {
    dispararConfetes();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
    dispararToastVitoria(gincana.nome);
}
