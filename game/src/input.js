// Keyboard + mouse input with edge-triggered presses and pointer lock.
// The game loop calls endFrame() once per tick; hit()/mouseHit() are only
// true on the frame the key/button went down.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.held = new Set(); // e.code values currently down
    this.pressed = new Set(); // e.code values pressed since last endFrame
    this.mouseDown = new Set(); // buttons currently held (0 left, 2 right)
    this.mousePressed = new Set(); // buttons pressed since last endFrame
    this.dx = 0; // accumulated look deltas, pointer-locked only
    this.dy = 0;

    this._onKeyDown = (e) => {
      if (!e.repeat) {
        this.held.add(e.code);
        this.pressed.add(e.code);
      }
    };
    this._onKeyUp = (e) => this.held.delete(e.code);
    this._onMouseMove = (e) => {
      if (this.locked) {
        this.dx += e.movementX || 0;
        this.dy += e.movementY || 0;
      }
    };
    this._onMouseDown = (e) => {
      this.mouseDown.add(e.button);
      this.mousePressed.add(e.button);
    };
    this._onMouseUp = (e) => this.mouseDown.delete(e.button);
    this._onContext = (e) => e.preventDefault();
    // No state of our own to track here; `locked` reads the live value.
    this._onLockChange = () => {};

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    canvas.addEventListener('contextmenu', this._onContext);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  down(code) {
    return this.held.has(code);
  }

  // True only on the frame the key was pressed.
  hit(code) {
    return this.pressed.has(code);
  }

  // Accumulated mouse movement since the last call, then zeroed.
  look() {
    const out = { dx: this.dx, dy: this.dy };
    this.dx = 0;
    this.dy = 0;
    return out;
  }

  mouseHeld(button) {
    return this.mouseDown.has(button);
  }

  // True only on the frame the button was pressed.
  mouseHit(button) {
    return this.mousePressed.has(button);
  }

  get locked() {
    return document.pointerLockElement === this.canvas;
  }

  requestLock() {
    this.canvas.requestPointerLock();
  }

  // Call once per tick: clears edge triggers and look deltas.
  endFrame() {
    this.pressed.clear();
    this.mousePressed.clear();
    this.dx = 0;
    this.dy = 0;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    this.canvas.removeEventListener('contextmenu', this._onContext);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
}
