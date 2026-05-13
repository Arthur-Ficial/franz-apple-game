const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("2D context unavailable");

const APPLE_SIZE = 80;
const APPLE_RADIUS = APPLE_SIZE / 2;
const MOVE_INTERVAL_MS = 800;

let score = 0;
let appleX = 0;
let appleY = 0;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

function moveApple(): void {
  appleX = APPLE_RADIUS + Math.random() * (canvas.width - APPLE_SIZE);
  appleY = APPLE_RADIUS + Math.random() * (canvas.height - APPLE_SIZE);
}

function draw(bg: HTMLImageElement, apple: HTMLImageElement): void {
  ctx!.drawImage(bg, 0, 0, canvas.width, canvas.height);
  ctx!.drawImage(
    apple,
    appleX - APPLE_RADIUS,
    appleY - APPLE_RADIUS,
    APPLE_SIZE,
    APPLE_SIZE,
  );

  ctx!.fillStyle = "#ffffff";
  ctx!.font = "20px system-ui, sans-serif";
  ctx!.textBaseline = "top";
  ctx!.fillText(`Score: ${score}`, 12, 12);
}

async function start(): Promise<void> {
  const [bg, apple] = await Promise.all([
    loadImage("/bg.png"),
    loadImage("/apple.png"),
  ]);

  canvas.addEventListener("click", (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const dx = x - appleX;
    const dy = y - appleY;
    if (dx * dx + dy * dy <= APPLE_RADIUS * APPLE_RADIUS) {
      score += 1;
      moveApple();
      draw(bg, apple);
    }
  });

  moveApple();
  draw(bg, apple);
  setInterval(() => {
    moveApple();
    draw(bg, apple);
  }, MOVE_INTERVAL_MS);
}

void start();
