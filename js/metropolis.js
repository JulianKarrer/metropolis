
// ====================================================================================================================

const wg = window.innerWidth; const hg = window.innerHeight;
const main_bg_canv = document.getElementById("main-bg");
main_bg_canv.width = wg; main_bg_canv.height = hg
let bg_ctx
let bg_buf_data

// ====================================================================================================================

// parameters
let slp = [0.75, 0.75]
let lp  = [0.75, 0.75]
const eps = 1e-2
const batch_size = 10000
const stepsize = 0.001
const bigstep_p = 0.001
let bg_enabled = false
let bg_segments_painted = 0
const max_segments = 10_000_000/1864*wg
const bgcol = "#ffffff"+"22"

const gauss = (x, mu, sig2) => 1./(Math.sqrt(2.*Math.PI*sig2))*Math.exp(-(x-mu)*(x-mu)/(2.0 * sig2));
const gauss_std = (x) => 1./(Math.sqrt(2.*Math.PI))*Math.exp(-x*x/2.0);
const periodic = x => x < 0 ? (x + 1) : (x > 1 ? (x - 1) : (x))
const get_bg_buf = (xp,yp,buf) => {
    let x = Math.floor(xp * buf.width);
    let y = Math.floor(yp * buf.height);
    if (x < 0 || x >= buf.width || y < 0 || y >= buf.height) {return 0;} //check out of bounds
    const buf_index = y * (buf.width * 4) + x * 4;
    const value = buf.data[buf_index]/255.;
    return value;
}

function gen_point(lp, f, bigstep_p, stepsize){
    // define function to sample
    while (true){
        // make a proposal
        let px 
        let py
        let [lx, ly] = lp
        if (Math.random() < bigstep_p){
            // global step
            px = Math.random()
            py = Math.random()
        } else {
            // local step
            // generate standard normal dist
            // https://bjlkeng.io/posts/sampling-from-a-normal-distribution/
            let fact = Math.sqrt(-2*Math.log(Math.random()))
            let inner = 2.*Math.PI*Math.random()
            let X = fact * Math.cos(inner)
            let Y = fact * Math.sin(inner)
            // scale the std. normal distribution and add it to last sample
            // use periodic boudnary conditions
            px = periodic(lx + X * stepsize)
            py = periodic(ly + Y * stepsize)
        }
        // if the proposal is accepted, return
        let old_val = f(lx, ly)
        let alpha = old_val < 1e-8 ? 1 : f(px, py)/old_val
        if (Math.random() <= alpha ){
            // also accept jump in case 0/0
            return [px, py]
        }
    }
    
}
function clear_bg_main(){
    bg_ctx.clearRect(0, 0, main_bg_canv.width, main_bg_canv.height);
}

function draw_bg_main() {
    if (bg_enabled){
        const scl = 0.02
        const f_1 = (x, y) => gauss(x,0.1,scl) * gauss(y,0.9,scl)
        const f_2 = (x, y) => gauss(x,0.9,scl) * gauss(y,0.1,scl)
        for (let i=0; i<batch_size; i++){
            slp = lp
            lp = gen_point(lp, (x,y) => get_bg_buf(x,y,bg_buf_data) + 0.05*f_1(x,y)+ 0.05*f_2(x,y), bigstep_p, stepsize)
            bg_segments_painted += 1
            let [slx, sly] = slp
            let [lx, ly] = lp
            // don't draw jumps due to periodic boundary
            if (!(Math.abs(slx-lx)>0.9 || Math.abs(sly-ly)>0.9)){
                // otherwise, draw the new segment
                bg_ctx.beginPath();
                bg_ctx.moveTo(slx*wg, sly*hg);
                bg_ctx.lineTo(lx*wg,ly*hg);
                bg_ctx.stroke();
            }
        }
        if (bg_segments_painted < max_segments){
            requestAnimationFrame(draw_bg_main)
        }
    }
}
const toggle_bg = () => {if (bg_enabled) {bg_enabled = false; clear_bg_main(); bg_segments_painted = 0;} else {bg_enabled = true; draw_bg_main()}}

const start_animation = () => {
    if (main_bg_canv.getContext) {
        {
            // initialize buffer
            const canvas = document.getElementById("main-bg-buff")
            canvas.width = wg; canvas.height = hg
            const ctx = canvas.getContext("2d");
            let size_vw = 15
            let lineheight = 0.01*size_vw*2./3.*wg;
            ctx.fillStyle = "white"
            ctx.font = String(size_vw) + "vw DegularBold";
            ctx.textAlign = "center"
            ctx.fillText("METROPOLIS", wg/2, hg/2);
            ctx.fillText("SAMPLING", wg/2, hg/2+lineheight);
            bg_buf_data = ctx.getImageData(0, 0, wg, hg);
        }
        bg_ctx = main_bg_canv.getContext("2d");
        bg_ctx.strokeStyle = bgcol
        draw_bg_main()
    }
}
// delay drawing the bg buffer to give the font a chance to load
setTimeout(start_animation, 500)

// ====================================================================================================================

/// plot a function f on domain [0;1) onto context
/// from specified top left position with width w and height h
function plot_f(f, ctx, w, h, t, l, col, dots, show_f){
    if (w <= 1){return}
    // get funciton values
    let vals = []
    let min = Infinity
    let max = -Infinity
    for (let i=0; i<w; i++){
        let val = f(i/w)
        vals.push(val)
        min = Math.min(min, val)
        max = Math.max(max, val)
    }
    // add a 2% margin
    let span = max - min
    min -= 0.01 * span
    max += 0.01 * span
    span = max - min
    // normalize values to [0;1]
    if (span > 1e-6){
        for (let i=0; i<w; i++){
            vals[i] = (vals[i] - min)/span
        }
    }
    // plot
    ctx.strokeStyle = col
    ctx.lineWidth = 2
    if (show_f){
        ctx.beginPath();
        ctx.moveTo(l, t+h-vals[0]*h);
        for (let i=1; i<w; i++){
            ctx.lineTo(l+i,t+h-vals[i]*h);
        }
        ctx.stroke();
    }
    // draw dots
    for (let i=0; i<dots.length; i++){
        ctx.beginPath()
        ctx.arc(l+dots[i]*w, t+h-(f(dots[i])-min)/span*h, 5, 0, 2 * Math.PI)
        ctx.fill()
    }
}

function densityEstimate(values, x) {
    const N = values.length;
    if (N === 0) return 0;
    // sample mean
    const mean = values.reduce((sum, v) => sum + v, 0) / N;
    // sample standard deviation
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (N - 1);
    let std = Math.sqrt(variance);
    if (N===1){std = 0.01}
    // Silverman's rule of thumb for Gaussian: h = 1.06 * sigma * N^(-1/5)
    const h = 1.06 * std * Math.pow(N, -1 / 5);
    if (h <= 0) return 0;
    // Cubic spline kernel normalization in 1D: a = 2 / (3h)
    const a = 2 / (3 * h);
    let sumW = 0;
    // SPH sum:
    for (let i = 0; i < N; i++) {
      const r = Math.abs(x - values[i]);
      const q = r / h;
      let w = 0;
      if (q < 1) {
        w = a * (1 - 1.5 * q * q + 0.75 * q * q * q);
      } else if (q < 2) {
        w = a * (0.25 * Math.pow(2 - q, 3));
      }
      // otherwise implicitly w = 0
      sumW += w;
    }
    // Normalize by number of samples to make total integral ~1
    return sumW / N;
  }

function reinvent(canv, show_f){
    const w = 0.5*wg//canv.clientWidth
    const h = 0.5*hg//canv.clientHeight
    canv.height = h
    canv.width = w

    const ctx = canv.getContext("2d");
    let pointer_x = null
    let pointer_y = null
    let dots = []

    canv.addEventListener("pointermove", (e) => { 
        const rect = canv.getBoundingClientRect();
        pointer_x = (e.clientX - rect.left) / rect.width;
        pointer_y = (e.clientY - rect.top) / rect.height;
        requestAnimationFrame(redraw)
    })
    canv.addEventListener("click", (_)=>{
        if (pointer_x){
            dots.push(pointer_x)
        }
    })

    const f = x => show_f ? gauss(x, 0.5, 0.01) : Math.max(gauss(x, 0.2, 0.002) + 1.5* gauss(x, 0.6, 0.01) - 0.1, 0.)

    function redraw(){
        ctx.clearRect(0, 0, w,h);
        let y_off = h/4
        plot_f(f, ctx, w, h/2, y_off, 0, "rgba(255,255,255,1)", dots, show_f)
        if (pointer_x && pointer_y){
            // draw pointer dot
            ctx.fillStyle = "rgba(255,255,255,1)"
            ctx.beginPath()
            ctx.arc(pointer_x*w, h/2+y_off, 6, 0, 2 * Math.PI)
            ctx.fill()
            // draw all other dots
            ctx.fillStyle = "rgba(255,255,255,0.5)"
            if (show_f){
                for (let i=0; i<dots.length; i++){
                    // on the line
                    ctx.beginPath()
                    ctx.arc(dots[i]*w, h/2+y_off, 5, 0, 2 * Math.PI)
                    ctx.fill()
                }
            }
            // plot the smooth density estimation
            plot_f(x => densityEstimate(dots, x), ctx, w, h/2, y_off, 0, "rgba(255,100,100,0.5)", [], true)
        }
    }
    redraw()

}

reinvent(document.getElementById("reinvent"), true)
reinvent(document.getElementById("reinvent-blind"), false)


// ====================================================================================================================

{
    // initialize buffer
    const canv = document.getElementById("ergo-buf")
    const w = 0.5*wg//canv.clientWidth
    const h = 0.5*hg//canv.clientHeight
    const markov_canv = document.getElementById("ergo")
    const markov_ctx = markov_canv.getContext("2d");
    canv.height = h
    canv.width = w
    markov_canv.height = h
    markov_canv.width = w

    const ctx = canv.getContext("2d");
    ctx.strokeStyle = "rgba(255,255,255,0.1)"
    ctx.lineWidth = 20
    ctx.lineCap = "round"
    let lx 
    let ly 
    let abort = false
    canv.addEventListener("pointermove", (e) => { 
        const rect = canv.getBoundingClientRect();
        pointer_x = (e.clientX - rect.left) / rect.width;
        pointer_y = (e.clientY - rect.top) / rect.height;
        if (e.buttons > 0){
            ctx.beginPath();
            ctx.moveTo(lx*w, ly*h);
            ctx.lineTo(pointer_x*w, pointer_y*h);
            ctx.stroke();
        }
        lx = pointer_x
        ly = pointer_y
    })

    const new_chain = ()=>{
        const num_steps = 1_000_000
        const buf = ctx.getImageData(0, 0, w-1, h-1);
        let lp = [lx, ly]
        let slp
        // make sure initial point is non-zero 
        // while(!get_bg_buf(lx,ly,buf) > 0.){
        //     lp = [Math.random(), Math.random()]
        // }
        markov_ctx.clearRect(0, 0, markov_canv.width, markov_canv.height)
        markov_ctx.strokeStyle = "rgba(255,0,0,1)"
        markov_ctx.lineWidth = 1

        let steps = 0
        const draw_batch = () => {
            let small_step_size = parseInt(document.getElementById("ergo-small-step").value)*1e-3
            let big_step_prob = parseInt(document.getElementById("ergo-big-step").value)*1e-6
            markov_ctx.beginPath();
            for (let i=0; i<batch_size; i++){
                slp = lp
                lp = gen_point(lp, (x,y) => get_bg_buf(x,y,buf), big_step_prob, small_step_size)
                let [slx, sly] = slp
                let [lx, ly] = lp
                // don't draw jumps due to periodic boundary
                if (!(Math.abs(slx-lx)>0.9 || Math.abs(sly-ly)>0.9)){
                    // otherwise, draw the new segment
                    markov_ctx.moveTo(slx*w, sly*h);
                    markov_ctx.lineTo(lx*w,ly*h);
                }
                steps += 1
            }
            markov_ctx.stroke();
            if (steps < num_steps && !abort){
                requestAnimationFrame(draw_batch)
            }
        }
        draw_batch()
        
    }

    document.body.addEventListener("keydown", (e) => {
        if (e.key === "m"){abort = true; setTimeout(()=>{abort = false; new_chain();}, 100) }
        if (e.key === "r"){abort = true; setTimeout(()=>{
            abort = false; 
            markov_ctx.clearRect(0, 0, markov_canv.width, markov_canv.height);
            ctx.clearRect(0, 0, canv.width, canv.height)
        }, 100) }
    })
}

// ====================================================================================================================
function gen_point_1d(last, f, bigstep_p, stepsize){
    // define function to sample
    let rej = 0
    while (true){
        // make a proposal
        let px 
        if (Math.random() < bigstep_p){
            // global step
            px = Math.random()
        } else {
            // local step
            // generate standard normal dist
            // https://bjlkeng.io/posts/sampling-from-a-normal-distribution/
            let fact = Math.sqrt(-2*Math.log(Math.random()))
            let inner = 2.*Math.PI*Math.random()
            let X = fact * Math.cos(inner)
            // scale the std. normal distribution and add it to last sample
            // use periodic boudnary conditions
            px = periodic(last + X * stepsize)
        }
        // if the proposal is accepted, return
        let alpha = f(px)/f(last)
        if (Math.random() <= alpha ){
            // also accept jump in case 0/0
            return [px, rej]
        } 
        rej += 1
    }
}

function measure_quality(dots, f, samples) {
    let expected = 0;
    for (let i = 0; i < samples; i++) {
      let x = i/samples;
      expected += f(x)/samples;
    }
  
    // Measured average of f(x) over samples
    let measured = 0;
    for (let i = 0; i < dots.length; i++) {
      measured += f(dots[i]) / densityEstimate(dots, dots[i])/ dots.length;
    }
  
   return ((1.-(Math.abs(expected-measured)/expected))*100);
  }

function variance(canv){
    const w = 0.5*wg//canv.clientWidth
    const h = 0.5*hg//canv.clientHeight
    canv.height = h
    canv.width = w

    const ctx = canv.getContext("2d");
    let dots = []

    const f = x => Math.max(gauss(x, 0.2, 0.003) + 1.5* gauss(x, 0.6, 0.01) - 0.1, 0.001)

    function redraw(){
        ctx.fillStyle = "rgba(255,255,255,0.5)"
        ctx.clearRect(0, 0, w,h);
        let y_off = h/4
        plot_f(f, ctx, w, h/2, y_off, 0, "rgba(255,255,255,1)", [], true)
        // draw all other dots
        // plot the smooth density estimation
        plot_f(x => densityEstimate(dots, x), ctx, w, h/2, y_off, 0, "rgba(255,100,100,0.5)", [], true)
        for (let i=0; i<dots.length; i++){
            // on the line
            ctx.beginPath()
            ctx.arc(dots[i]*w, h/2+y_off, 5, 0, 2 * Math.PI)
            ctx.fill()
        }
    }


    function generate_dots (e){
        let small_step_size = parseInt(document.getElementById("var-small-step").value)*1e-2
        let big_step_prob = parseInt(document.getElementById("var-big-step").value)*1e-2
        let samples = parseInt(document.getElementById("var-steps").value)
        
        let rejected = 0
        dots = [Math.random()]
        dots_exact = [Math.random()]
        for (let i=0; i<samples-1;i++){
            let [x, rej] = gen_point_1d(dots.at(-1), f, big_step_prob, small_step_size)
            dots.push(x)
            for (let i=0; i<rej; i++){
                dots_exact.push(dots.at(-1))
            }
            dots_exact.push(x)
            rejected += rej
        }
        let quality = measure_quality(dots_exact, f, 1000)
        document.getElementById("var-acceptance").innerText = "Akzeptanz " + (100*samples/(rejected+samples)).toFixed(1) + "%"
        document.getElementById("var-quality").innerText = "Genauigkeit " + quality.toFixed(1) + "%"
        redraw()
    }


    canv.addEventListener("click", generate_dots)
    generate_dots(true);

}

variance(document.getElementById("variance"))
