window.addEventListener("DOMContentLoaded", () => {

  // --- DOM refs ---
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");


  const playBtn = document.getElementById("playBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const stepBackBtn = document.getElementById("stepBackBtn");
  const stepBtn = document.getElementById("stepBtn");
  const resetBtn = document.getElementById("resetBtn");

  const tValueSpan = document.getElementById("tValue");
  const aTValueSpan = document.getElementById("aTValue");
  const aNValueSpan = document.getElementById("aNValue");

  const v0Range = document.getElementById("v0Range");
  const v0ValueSpan = document.getElementById("v0Value");
  const thetaRange = document.getElementById("thetaRange");
  const thetaValueSpan = document.getElementById("thetaValue");

  const aTInput = document.getElementById("aTInput");
  const aNInput = document.getElementById("aNInput");
  const aTError = document.getElementById("aTError");
  const aNError = document.getElementById("aNError");

  const preset1Btn = document.getElementById("preset1");
  const preset2Btn = document.getElementById("preset2");
  const preset3Btn = document.getElementById("preset3");
  const preset4Btn = document.getElementById("preset4");
  const preset5Btn = document.getElementById("preset5");
  const preset6Btn = document.getElementById("preset6");
  const preset7Btn = document.getElementById("preset7");
  const preset8Btn = document.getElementById("preset8");
  const preset9Btn = document.getElementById("preset9");

  const statusDiv = document.getElementById("status");

  const showVelocityChk = document.getElementById("showVelocity");
  const showAccelerationChk = document.getElementById("showAcceleration");
  const showFullTrajectoryChk = document.getElementById("showFullTrajectory");

  const simTimeRange = document.getElementById("simTimeRange");
  const simTimeValueSpan = document.getElementById("simTimeValue");

  // --- Simulation parameters ---
  let dt = 0.01; // integration step (s)
  let t_max = parseFloat(simTimeRange.value) || 30; // maximum simulation time (s)
  let path = []; // array of {t,x,y,theta,v,aT,aN,ax,ay,...}
  let v0 = parseFloat(v0Range.value);
  let theta0 = degToRad(parseFloat(thetaRange.value));
  let t = 0; // current time
  let playing = false;
  let rafId = null;

  // drawing transform variables
  let x_max, x_min, y_max, y_min;
  let scaleFactor, x_center, y_center;

  // evaluator functions (set by parser)
  let aTangentialFunc = (t) => 0;
  let aNormalFunc = (t) => 0;

  // vector-scaling helpers
  let maxV = 1;
  let maxA = 1;


  let slinger = false;


  // default expressions
  const defaultAT = "1.5*cos(t)";
  const defaultAN = "-1.899+3*sin(t)";

  // --- Utility ---
  function degToRad(d) { return d * Math.PI / 180; }
  function radToDeg(r) { return r * 180 / Math.PI; }

  // --- Expression parser/evaluator (improved) ---
  const allowedNames = [
      "sin","cos","tan","asin","acos","atan",
      "sinh","cosh","tanh",
      "exp","log","sqrt","abs","pow","floor","ceil","round","max","min",
      "PI","pi","E","e","pow",
      "v0","theta0"
  ];

  function sanitizeAndBuildFunction(exprRaw) {
      if (typeof exprRaw !== "string") exprRaw = String(exprRaw);
      let expr = exprRaw.trim();
      expr = expr.replace(/\^/g, "**");

      if (/[^0-9A-Za-z+\-*/%()., _\s\*\*]/.test(expr)) {
          throw new Error("Expression contains invalid characters.");
      }

      const idents = (expr.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []).filter(Boolean);
      const unique = [...new Set(idents)];

      for (const id of unique) {
          if (id === "t") continue;
          if (id === "Math") {
              throw new Error("Direct use of Math is not allowed; use available functions like sin, cos, exp, pi, e.");
          }
          const idLower = id.toLowerCase();
          const found = allowedNames.some(name => name.toLowerCase() === idLower);
          if (!found) {
              throw new Error(`Unknown identifier: "${id}". Only t, v0, theta0, and standard math functions allowed.`);
          }
      }

      const usedNames = unique.filter(id => id !== "t").map(id => {
          const lower = id.toLowerCase();
          if (lower === "pi") return "pi";
          if (lower === "e") return "e";
          if (lower === "v0") return "v0";
          if (lower === "theta0") return "theta0";
          return id.toLowerCase();
      });

      const usedSet = [...new Set(usedNames)];
      const argNames = ["t", ...usedSet];
      const fnBody = `return (${expr});`;
      let rawFn;
      try {
          rawFn = new Function(...argNames, fnBody);
      } catch (e) {
          throw new Error("Syntax error in expression.");
      }

      function makeCaller() {
          return function(tVal) {
              const args = [tVal];
              for (const name of usedSet) {
                  const n = name.toLowerCase();
                  if (n === "pi") args.push(Math.PI);
                  else if (n === "e") args.push(Math.E);
                  else if (n === "v0") args.push(v0);
                  else if (n === "theta0") args.push(theta0);
                  else {
                      if (n === "pow") args.push(Math.pow);
                      else if (typeof Math[n] === "function") args.push(Math[n]);
                      else args.push(undefined);
                  }
              }
              try {
                  const res = rawFn.apply(null, args);
                  return Number(res);
              } catch (err) {
                  throw err;
              }
          };
      }

      return makeCaller();
  }

  function updateUserFunctions() {
      aTError.textContent = "";
      aNError.textContent = "";
      statusDiv.textContent = "";

      slinger = false;
      if(aTInput.value == "(-1)*v0*sin(t)*cos(t)/sqrt(cos(t)^2)" && aNInput.value == "v0*cos(t)^2/sqrt(cos(t)^2)"){slinger = true;}

      let ok = true;
      try {
          const fAT = sanitizeAndBuildFunction(aTInput.value || "0");
          aTangentialFunc = function(tt) {
              try {
                  const v = fAT(tt);
                  return Number(v) || 0;
              } catch (e) {
                  throw new Error("Runtime error in a_t(t): " + (e.message || e));
              }
          };
      } catch (e) {
          aTangentialFunc = (t) => 0;
          aTError.textContent = e.message;
          ok = false;
      }

      try {
          const fAN = sanitizeAndBuildFunction(aNInput.value || "0");
          aNormalFunc = function(tt) {
              try {
                  const v = fAN(tt);
                  return Number(v) || 0;
              } catch (e) {
                  throw new Error("Runtime error in a_n(t): " + (e.message || e));
              }
          };
      } catch (e) {
          aNormalFunc = (t) => 0;
          aNError.textContent = e.message;
          ok = false;
      }

      return ok;
  }

  // --- Presets (9) ---
  const presets = {
      preset1: { v0: 2, theta: 0, tmax: 30, aT: "1", aN: "0" },                     
      preset2: { v0: 2, theta: 0, tmax: 60, aT: "0", aN: "1" },
      preset3: { v0: 0, theta: 0, tmax: 20, aT: "30", aN: "t^2" },
      preset4: { v0: 8, theta: 0, tmax: 30, aT: "(-1)*v0*sin(t)*cos(t)/sqrt(cos(t)^2)", aN: "v0*cos(t)^2/sqrt(cos(t)^2)" },
      preset5: { v0: 10, theta: 60, tmax: 5*Math.sqrt(3), aT: "(4*t-2*v0*sin(theta0))/sqrt(v0^2+4*t^2-4*v0*sin(theta0)*t)", aN: "(-2*v0*cos(theta0))/sqrt(v0^2+4*t^2-4*v0*sin(theta0)*t)" },                
      preset6: { v0: 0, theta: 90, tmax: 20, aT: "cos(t)", aN: "0" },
      preset7: { v0: 4.6, theta: 0, tmax: 60, aT: "0", aN: "6-0.2*t" },
      preset8: { v0: 5.73, theta: -36, tmax: 60, aT: "0", aN: "-1.91+8*sin(t)" },
      preset9: { v0: 4.32, theta: -45, tmax: 60, aT: "1.5*cos(t)", aN: "-1.899+3*sin(t)" }
  };

  function applyPreset(name) {
      if (!presets[name]) return;
      const p = presets[name];
      // set values in UI
      v0Range.value = p.v0;
      v0 = Number(p.v0);
      v0ValueSpan.textContent = v0.toFixed(2);

      thetaRange.value = p.theta;
      theta0 = degToRad(Number(p.theta));
      thetaValueSpan.textContent = `${Number(p.theta).toFixed(0)}°`;

      simTimeRange.value = p.tmax;
      t_max = Number(p.tmax);
      simTimeValueSpan.textContent = t_max.toFixed(1);

      aTInput.value = p.aT;
      aNInput.value = p.aN;

      // apply -> pause and reset current time
      pauseAndReset();
      const ok = updateUserFunctions();
      if (!ok) {
          statusDiv.textContent = `${name} applied but expression error occurred.`;
          statusDiv.style.color = "red";
      } else {
          //statusDiv.textContent = `Applied ${name}`;
          statusDiv.textContent = ``;
          statusDiv.style.color = "black";
      }
      computeTrajectory();
      drawTrajectory();
  }

  // --- Trajectory computation ---
  function computeTrajectory() {
      // reset path
      path = [];
      maxV = 1;
      maxA = 1;

      // initial states
      let x = 0;
      let y = 0;
      let theta = theta0;
      let v = v0;

      x_max = x_min = x;
      y_max = y_min = y;

      const steps = Math.max(1, Math.floor(t_max / dt));
      let cur_t = 0;

      for (let i = 0; i <= steps; i++, cur_t += dt) {
          let at = 0, an = 0;
          try {
              at = aTangentialFunc(cur_t) || 0;
          } catch (err) {
              aTError.textContent = err.message || String(err);
              at = 0;
          }
          try {
              an = aNormalFunc(cur_t) || 0;
          } catch (err) {
              aNError.textContent = err.message || String(err);
              an = 0;
          }


          if(slinger){
            let phi_0 = Math.atan(10*theta0/v0);
            let A = v0/(10*Math.cos(phi_0));
            let alpha = A*Math.sin(cur_t+phi_0);

            x = 10*Math.sin(alpha);
            y= -10*Math.cos(alpha);

            let vx = 10*A*Math.cos(cur_t+phi_0)*Math.cos(alpha);
            let vy = 10*A*Math.cos(cur_t+phi_0)*Math.sin(alpha);

            let ax = -10*A**2*Math.cos(cur_t+phi_0)**2*Math.sin(alpha)-10*alpha*Math.cos(alpha);
            let ay = 10*A**2*Math.cos(cur_t+phi_0)**2*Math.cos(alpha)-10*alpha*Math.sin(alpha);

            v = Math.sqrt(vx**2+vy**2);
            theta = Math.atan2(vy,vx);
            console.log(vy/vx);
            let aMag = Math.sqrt(ax**2+ay**2);
            at = ax*Math.cos(theta)+ay*Math.sin(theta);
            an = -ax*Math.sin(theta)+ay*Math.cos(theta);

            // acceleration components in world coordinates:
            const aTx = at * Math.cos(theta);
            const aTy = at * Math.sin(theta);
            // normal direction is +90deg rotation of velocity (positive an increases theta)
            const aNx = an * (-Math.sin(theta));
            const aNy = an * ( Math.cos(theta));

            path.push({
              t: cur_t,
              x, y, theta, v,
              aT: at, aN: an,
              ax, ay, aTx, aTy, aNx, aNy,
              aMag
            });

            

            // track bounds
            if (x < x_min) x_min = x;
            if (x > x_max) x_max = x;
            if (y < y_min) y_min = y;
            if (y > y_max) y_max = y;

            // track max velocity and acceleration
            if (Math.abs(v) > maxV) maxV = Math.abs(v);
            if (aMag > maxA) maxA = aMag;

          }
          else{
            // update speed

            v += at * dt;

            // update heading based on normal acceleration
            if (v !== 0) {
                theta += (an / v) * dt;
            }

            // update position
            x += v * Math.cos(theta) * dt;
            y += v * Math.sin(theta) * dt;

            // acceleration components in world coordinates:
            const aTx = at * Math.cos(theta);
            const aTy = at * Math.sin(theta);
            // normal direction is +90deg rotation of velocity (positive an increases theta)
            const aNx = an * (-Math.sin(theta));
            const aNy = an * ( Math.cos(theta));

            const ax = aTx + aNx;
            const ay = aTy + aNy;

            const aMag = Math.hypot(ax, ay);
          
          path.push({
              t: cur_t,
              x, y, theta, v,
              aT: at, aN: an,
              ax, ay, aTx, aTy, aNx, aNy,
              aMag
          });

        

          // track bounds
          if (x < x_min) x_min = x;
          if (x > x_max) x_max = x;
          if (y < y_min) y_min = y;
          if (y > y_max) y_max = y;

          // track max velocity and acceleration
          if (Math.abs(v) > maxV) maxV = Math.abs(v);
          if (aMag > maxA) maxA = aMag;

        }
      }

      // center & scale for trajectory (leave small padding)
      x_center = (x_max + x_min) / 2;
      y_center = (y_max + y_min) / 2;
      const padding = 0.9;
      const spanX = (x_max - x_min) || 1;
      const spanY = (y_max - y_min) || 1;
      scaleFactor = Math.min(
          padding * canvas.width / spanX,
          padding * canvas.height / spanY
      );
      if (!isFinite(scaleFactor) || scaleFactor === 0) {
          scaleFactor = 1;
      }
  }

  // --- Drawing helpers ---
  function drawArrow(fromX, fromY, toX, toY, options = {}) {
      const { color = "black", width = 2, headLength = 8, dash = [] } = options;
      ctx.save();
      ctx.beginPath();
      if (dash && dash.length) ctx.setLineDash(dash);
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();

      const angle = Math.atan2(toY - fromY, toX - fromX);
      ctx.beginPath();
      ctx.setLineDash([]);
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - headLength * Math.cos(angle - Math.PI / 6), toY - headLength * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(toX - headLength * Math.cos(angle + Math.PI / 6), toY - headLength * Math.sin(angle + Math.PI / 6));
      ctx.lineTo(toX, toY);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
  }

  // draw trajectory and optionally vectors and labels
  function drawTrajectory() {
      // clear in device pixels
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (!path || path.length === 0) return;

      // clamp index to bounds
      const idx = Math.min(path.length - 1, Math.max(0, Math.floor(t / dt)));

      // draw path
      ctx.beginPath();
      const start = path[0];
      const x0 = canvas.width / 2 + scaleFactor * (start.x - x_center);
      const y0 = canvas.height / 2 - scaleFactor * (start.y - y_center);
      ctx.moveTo(x0, y0);

      if (showFullTrajectoryChk.checked) {
          // draw full path
          for (let i = 1; i < path.length; i++) {
              const p = path[i];
              const px = canvas.width / 2 + scaleFactor * (p.x - x_center);
              const py = canvas.height / 2 - scaleFactor * (p.y - y_center);
              ctx.lineTo(px, py);
          }
      } else {
          // draw up to current idx
          for (let i = 1; i <= idx; i++) {
              const p = path[i];
              const px = canvas.width / 2 + scaleFactor * (p.x - x_center);
              const py = canvas.height / 2 - scaleFactor * (p.y - y_center);
              ctx.lineTo(px, py);
          }
      }

      ctx.strokeStyle = "blue";
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.stroke();

      // draw current point
      const cur = path[idx];
      const cx = canvas.width / 2 + scaleFactor * (cur.x - x_center);
      const cy = canvas.height / 2 - scaleFactor * (cur.y - y_center);

      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, 2 * Math.PI);
      ctx.fillStyle = "red";
      ctx.fill();

      // update numeric displays
      tValueSpan.textContent = t.toFixed(2);
      aTValueSpan.textContent = (cur.aT !== undefined ? cur.aT.toFixed(4) : "0.0000");
      aNValueSpan.textContent = (cur.aN !== undefined ? cur.aN.toFixed(4) : "0.0000");

      // set a common font for labels
      ctx.font = `${12 * (window.devicePixelRatio || 1)}px Arial`;
      ctx.textBaseline = "middle";

      // draw velocity vector if requested
      if (showVelocityChk.checked) {
          const allowedPixels = 0.15 * Math.min(canvas.width, canvas.height);
          const vScale = maxV > 0 ? allowedPixels / maxV : 0;

          const vx = cur.v * Math.cos(cur.theta);
          const vy = cur.v * Math.sin(cur.theta);
          const vxPx = vx * vScale;
          const vyPx = vy * vScale;
          const toX = cx + vxPx;
          const toY = cy - vyPx;
          drawArrow(cx, cy, toX, toY, { color: "green", width: 3, headLength: 10 });

          //label velocity vector
          ctx.fillStyle = "green";
          ctx.font = "16px Arial";
          ctx.fillText("→", toX + 8, toY - 16); 
          ctx.font = "20px Arial";
          ctx.fillText("v", toX + 8, toY - 4);

      }

      // draw acceleration vector and decomposition if requested
      if (showAccelerationChk.checked) {
          const allowedPixels = 0.15 * Math.min(canvas.width, canvas.height);
          const aScale = maxA > 0 ? allowedPixels / maxA : 0;

          const axPx = cur.ax * aScale;
          const ayPx = cur.ay * aScale;
          const toX = cx + axPx;
          const toY = cy - ayPx;
          drawArrow(cx, cy, toX, toY, { color: "#8a2be2", width: 3, headLength: 10 });

          //label total acceleration
          ctx.fillStyle = "#8a2be2";
          ctx.font = "16px Arial";
          ctx.fillText("→", toX + 8, toY - 16); 
          ctx.font = "20px Arial"; 
          ctx.fillText("a", toX + 8, toY - 4);

          // tangential component
          const aTxPx = cur.aTx * aScale;
          const aTyPx = cur.aTy * aScale;
          const tEndX = cx + aTxPx;
          const tEndY = cy - aTyPx;
          if(Math.abs(cur.aT)>0.001){
          drawArrow(cx, cy, tEndX, tEndY, { color: "#ff7f0e", width: 2, headLength: 8 });
          //label tangential acceleration
          ctx.fillStyle = "#ff7f0e";
          ctx.font = "16px Arial";
          ctx.fillText("→", tEndX + 8, tEndY - 16); 
          ctx.font = "20px Arial"; 
          ctx.fillText("a", tEndX + 8, tEndY - 4);
          ctx.font = "12px Arial"; 
          ctx.fillText("t", tEndX + 20, tEndY + 2);
          }

          // normal component
          const aNxPx = cur.aNx * aScale;
          const aNyPx = cur.aNy * aScale;
          const nEndX = cx + aNxPx;
          const nEndY = cy - aNyPx;
          if(Math.abs(cur.aN)>0.001){
          drawArrow(cx, cy, nEndX, nEndY, { color: "#1f77b4", width: 2, headLength: 8 });
          //label tangential acceleration
          ctx.fillStyle = "#1f77b4";
          ctx.font = "16px Arial";
          ctx.fillText("→", nEndX + 8, nEndY - 16); 
          ctx.font = "20px Arial"; 
          ctx.fillText("a", nEndX + 8, nEndY - 4);
          ctx.font = "12px Arial"; 
          ctx.fillText("n", nEndX + 20, nEndY + 2);
          }

          // dashed lines to highlight decomposition
          ctx.save();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = "#444";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(tEndX, tEndY);
          ctx.lineTo(toX, toY);
          ctx.lineTo(nEndX, nEndY);
          ctx.stroke();
          ctx.restore();
      }
  }

  // --- Controls behavior ---
  function play() {
      if (playing) return;
      playing = true;
      let lastTime = performance.now();
      function stepRAF(now) {
          if (!playing) return;
          let elapsedMs = now - lastTime;
          lastTime = now;
          let elapsedS = elapsedMs / 1000;
          if (elapsedS > 0.2) elapsedS = 0.2;
          let toAdvance = elapsedS;
          while (toAdvance > 0) {
              const step = Math.min(dt, toAdvance);
              t += step;
              toAdvance -= step;
              if (t > t_max) {
                  t = t_max;
                  playing = false;
                  break;
              }
          }
          drawTrajectory();
          if (playing) rafId = requestAnimationFrame(stepRAF);
      }
      rafId = requestAnimationFrame(stepRAF);
  }

  function pause() {
      playing = false;
      if (rafId) cancelAnimationFrame(rafId);
  }

  function pauseAndReset() {
      pause();
      t = 0;
      drawTrajectory();
  }

   function stepBackOnce() {
      if (t > 0) {
          t = Math.max(0, t - 5*dt);
          drawTrajectory();
      }
  }

  function stepOnce() {
      if (t < t_max) {
          t = Math.min(t_max, t + 5*dt);
          drawTrajectory();
      }
  }

  function resetSim() {
      pause();
      t = 0;
      computeTrajectory();
      drawTrajectory();
  }

  // --- Canvas resizing (responsive) ---
  function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
      }
      computeTrajectory();
      drawTrajectory();
  }





  // --- Event listeners ---
  playBtn.addEventListener("click", () => { play(); });
  pauseBtn.addEventListener("click", () => { pause(); });
  stepBackBtn.addEventListener("click", () => { pause(); stepBackOnce(); });
  stepBtn.addEventListener("click", () => { pause(); stepOnce(); });
  resetBtn.addEventListener("click", () => { resetSim(); });

  // sliders: when changed, reset time to 0 and pause
  v0Range.addEventListener("input", (e) => {
      v0 = parseFloat(e.target.value);
      v0ValueSpan.textContent = v0.toFixed(2);
      pauseAndReset();
      computeTrajectory();
      drawTrajectory();
  });

  thetaRange.addEventListener("input", (e) => {
      const deg = parseFloat(e.target.value);
      thetaValueSpan.textContent = `${deg.toFixed(0)}°`;
      theta0 = degToRad(deg);
      pauseAndReset();
      computeTrajectory();
      drawTrajectory();
  });

  simTimeRange.addEventListener("input", (e) => {
      t_max = parseFloat(e.target.value);
      simTimeValueSpan.textContent = t_max.toFixed(1);
      pauseAndReset();
      computeTrajectory();
      drawTrajectory();
  });

  // expression changes: on change -> pause/reset + update functions + compute
  aTInput.addEventListener("change", () => {
      pauseAndReset();
      const ok = updateUserFunctions();
      if (ok) {
          statusDiv.textContent = "";
      } else {
          statusDiv.textContent = "Expression error — see messages.";
          statusDiv.style.color = "red";
      }
      computeTrajectory();
      drawTrajectory();
  });

  aNInput.addEventListener("change", () => {
      pauseAndReset();
      const ok = updateUserFunctions();
      if (ok) {
          statusDiv.textContent = "";
      } else {
          statusDiv.textContent = "Expression error — see messages.";
          statusDiv.style.color = "red";
      }
      computeTrajectory();
      drawTrajectory();
  });

  // presets: apply then pause/reset and recompute
  preset1Btn.addEventListener("click", () => { applyPreset("preset1"); });
  preset2Btn.addEventListener("click", () => { applyPreset("preset2"); });
  preset3Btn.addEventListener("click", () => { applyPreset("preset3"); });
  preset4Btn.addEventListener("click", () => { applyPreset("preset4"); });
  preset5Btn.addEventListener("click", () => { applyPreset("preset5"); });
  preset6Btn.addEventListener("click", () => { applyPreset("preset6"); });
  preset7Btn.addEventListener("click", () => { applyPreset("preset7"); });
  preset8Btn.addEventListener("click", () => { applyPreset("preset8"); });
  preset9Btn.addEventListener("click", () => { applyPreset("preset9"); });


  // checkboxes: just redraw / recompute if needed
  showVelocityChk.addEventListener("change", () => { drawTrajectory(); });
  showAccelerationChk.addEventListener("change", () => { drawTrajectory(); });
  showFullTrajectoryChk.addEventListener("change", () => { drawTrajectory(); });

  // window resize: debounce, then resize
  window.addEventListener("resize", () => {
      clearTimeout(window._resizeTimeout);
      window._resizeTimeout = setTimeout(() => {
          resizeCanvas();
      }, 80);
  });




  // --- Initialization ---
  function init() {
      // UI initial values
      v0 = parseFloat(v0Range.value);
      v0ValueSpan.textContent = v0.toFixed(2);

      theta0 = degToRad(parseFloat(thetaRange.value));
      thetaValueSpan.textContent = `${parseFloat(thetaRange.value).toFixed(0)}°`;

      t_max = parseFloat(simTimeRange.value) || 30;
      simTimeValueSpan.textContent = t_max.toFixed(1);

      aTInput.value = defaultAT;
      aNInput.value = defaultAN;

      // build functions (display errors if any)
      updateUserFunctions();

      // set canvas size and compute initial trajectory
      resizeCanvas();

      // make sure simulation starts paused at t=0
      t = 0;
      playing = false;
      drawTrajectory();
  }

  init();
});
