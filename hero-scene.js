/* -------------------------------------------------------------
   POSTPROCESSING: inline EffectComposer + passes (Three r128 style)
   ------------------------------------------------------------- */

// Simplified EffectComposer (adapted from three.js examples)
(function(){

  THREE.Pass = function () {
    this.enabled = true;
    this.needsSwap = true;
    this.clear = false;
    this.renderToScreen = false;
  };
  THREE.Pass.prototype = {
    setSize: function () {},
    render: function () { console.error('THREE.Pass: .render() must be implemented.'); }
  };
  THREE.Pass.FullScreenQuad = (function(){
    var camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    var geometry = new THREE.PlaneBufferGeometry(2, 2);
    var FullScreenQuad = function (material) {
      this._mesh = new THREE.Mesh(geometry, material);
    };
    Object.defineProperty(FullScreenQuad.prototype, 'material', {
      get: function () { return this._mesh.material; },
      set: function (value) { this._mesh.material = value; }
    });
    Object.assign(FullScreenQuad.prototype, {
      dispose: function () { this._mesh.geometry.dispose(); },
      render: function (renderer) { renderer.render(this._mesh, camera); }
    });
    return FullScreenQuad;
  })();

  /* CopyShader */
  THREE.CopyShader = {
    uniforms: { tDiffuse: { value: null }, opacity: { value: 1.0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
    fragmentShader: 'uniform float opacity; uniform sampler2D tDiffuse; varying vec2 vUv; void main() { vec4 texel = texture2D( tDiffuse, vUv ); gl_FragColor = opacity * texel; }'
  };

  /* ShaderPass */
  THREE.ShaderPass = function (shader, textureID) {
    THREE.Pass.call(this);
    this.textureID = (textureID !== undefined) ? textureID : 'tDiffuse';
    if (shader instanceof THREE.ShaderMaterial) {
      this.uniforms = shader.uniforms;
      this.material = shader;
    } else if (shader) {
      this.uniforms = THREE.UniformsUtils.clone(shader.uniforms);
      this.material = new THREE.ShaderMaterial({
        defines: Object.assign({}, shader.defines),
        uniforms: this.uniforms,
        vertexShader: shader.vertexShader,
        fragmentShader: shader.fragmentShader
      });
    }
    this.fsQuad = new THREE.Pass.FullScreenQuad(this.material);
  };
  THREE.ShaderPass.prototype = Object.assign(Object.create(THREE.Pass.prototype), {
    constructor: THREE.ShaderPass,
    render: function (renderer, writeBuffer, readBuffer) {
      if (this.uniforms[this.textureID]) {
        this.uniforms[this.textureID].value = readBuffer.texture;
      }
      this.fsQuad.material = this.material;
      if (this.renderToScreen) {
        renderer.setRenderTarget(null);
        this.fsQuad.render(renderer);
      } else {
        renderer.setRenderTarget(writeBuffer);
        if (this.clear) renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
        this.fsQuad.render(renderer);
      }
    }
  });

  /* RenderPass */
  THREE.RenderPass = function (scene, camera, overrideMaterial, clearColor, clearAlpha) {
    THREE.Pass.call(this);
    this.scene = scene;
    this.camera = camera;
    this.overrideMaterial = overrideMaterial;
    this.clearColor = clearColor;
    this.clearAlpha = (clearAlpha !== undefined) ? clearAlpha : 0;
    this.clear = true;
    this.clearDepth = false;
    this.needsSwap = false;
  };
  THREE.RenderPass.prototype = Object.assign(Object.create(THREE.Pass.prototype), {
    constructor: THREE.RenderPass,
    render: function (renderer, writeBuffer, readBuffer) {
      var oldAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      var oldClearColor, oldClearAlpha, oldOverrideMaterial;
      if (this.overrideMaterial !== undefined) {
        oldOverrideMaterial = this.scene.overrideMaterial;
        this.scene.overrideMaterial = this.overrideMaterial;
      }
      if (this.clearColor) {
        var _tmpColor = new THREE.Color();
        renderer.getClearColor(_tmpColor);
        oldClearColor = _tmpColor.getHex();
        oldClearAlpha = renderer.getClearAlpha();
        renderer.setClearColor(this.clearColor, this.clearAlpha);
      }
      if (this.clearDepth) renderer.clearDepth();
      renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
      if (this.clear) renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
      renderer.render(this.scene, this.camera);
      if (this.clearColor) renderer.setClearColor(oldClearColor, oldClearAlpha);
      if (this.overrideMaterial !== undefined) this.scene.overrideMaterial = oldOverrideMaterial;
      renderer.autoClear = oldAutoClear;
    }
  });

  /* EffectComposer */
  THREE.EffectComposer = function (renderer, renderTarget) {
    this.renderer = renderer;
    if (renderTarget === undefined) {
      var parameters = {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        stencilBuffer: false
      };
      var size = renderer.getDrawingBufferSize(new THREE.Vector2());
      renderTarget = new THREE.WebGLRenderTarget(size.width, size.height, parameters);
      renderTarget.texture.name = 'EffectComposer.rt1';
    }
    this.renderTarget1 = renderTarget;
    this.renderTarget2 = renderTarget.clone();
    this.renderTarget2.texture.name = 'EffectComposer.rt2';
    this.writeBuffer = this.renderTarget1;
    this.readBuffer = this.renderTarget2;
    this.renderToScreen = true;
    this.passes = [];
    this.copyPass = new THREE.ShaderPass(THREE.CopyShader);
    this.clock = new THREE.Clock();
  };
  Object.assign(THREE.EffectComposer.prototype, {
    swapBuffers: function () {
      var tmp = this.readBuffer;
      this.readBuffer = this.writeBuffer;
      this.writeBuffer = tmp;
    },
    addPass: function (pass) {
      this.passes.push(pass);
      var size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      pass.setSize(size.width, size.height);
    },
    render: function (deltaTime) {
      if (deltaTime === undefined) deltaTime = this.clock.getDelta();
      var currentRenderTarget = this.renderer.getRenderTarget();
      var maskActive = false;
      var pass, i, il = this.passes.length;
      for (i = 0; i < il; i++) {
        pass = this.passes[i];
        if (pass.enabled === false) continue;
        pass.renderToScreen = (this.renderToScreen && (i === il - 1));
        pass.render(this.renderer, this.writeBuffer, this.readBuffer, deltaTime, maskActive);
        if (pass.needsSwap) this.swapBuffers();
      }
      this.renderer.setRenderTarget(currentRenderTarget);
    },
    setSize: function (width, height) {
      this.renderTarget1.setSize(width, height);
      this.renderTarget2.setSize(width, height);
      for (var i = 0; i < this.passes.length; i++) {
        this.passes[i].setSize(width, height);
      }
    }
  });

  /* UnrealBloomPass (simplified but functional) */
  THREE.LuminosityHighPassShader = {
    shaderID: 'luminosityHighPass',
    uniforms: {
      tDiffuse: { value: null },
      luminosityThreshold: { value: 1.0 },
      smoothWidth: { value: 1.0 },
      defaultColor: { value: new THREE.Color(0x000000) },
      defaultOpacity: { value: 0.0 }
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform vec3 defaultColor;
      uniform float defaultOpacity;
      uniform float luminosityThreshold;
      uniform float smoothWidth;
      varying vec2 vUv;
      void main() {
        vec4 texel = texture2D( tDiffuse, vUv );
        vec3 luma = vec3( 0.299, 0.587, 0.114 );
        float v = dot( texel.xyz, luma );
        vec4 outputColor = vec4( defaultColor.rgb, defaultOpacity );
        float alpha = smoothstep( luminosityThreshold, luminosityThreshold + smoothWidth, v );
        gl_FragColor = mix( outputColor, texel, alpha );
      }`
  };

  /* GaussianBlur shader used by bloom */
  var BlurShader = {
    uniforms: {
      tDiffuse: { value: null },
      resolution: { value: new THREE.Vector2() },
      direction: { value: new THREE.Vector2(1, 0) }
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform vec2 resolution;
      uniform vec2 direction;
      varying vec2 vUv;
      void main() {
        vec2 off1 = vec2(1.411764705882353) * direction / resolution;
        vec2 off2 = vec2(3.2941176470588234) * direction / resolution;
        vec2 off3 = vec2(5.176470588235294) * direction / resolution;
        vec4 color = vec4(0.0);
        color += texture2D(tDiffuse, vUv) * 0.1964825501511404;
        color += texture2D(tDiffuse, vUv + off1) * 0.2969069646728344;
        color += texture2D(tDiffuse, vUv - off1) * 0.2969069646728344;
        color += texture2D(tDiffuse, vUv + off2) * 0.09447039785044732;
        color += texture2D(tDiffuse, vUv - off2) * 0.09447039785044732;
        color += texture2D(tDiffuse, vUv + off3) * 0.010381362401148057;
        color += texture2D(tDiffuse, vUv - off3) * 0.010381362401148057;
        gl_FragColor = color;
      }`
  };

  THREE.BloomPass = function (strength, kernelSize, threshold, resolution) {
    THREE.Pass.call(this);
    this.strength = strength !== undefined ? strength : 1;
    this.threshold = threshold !== undefined ? threshold : 0.8;
    this.resolution = resolution !== undefined ? resolution : new THREE.Vector2(256, 256);

    // Render targets for each mip level
    this.renderTargetsHorizontal = [];
    this.renderTargetsVertical = [];
    this.nMips = 3;

    var resx = Math.round(this.resolution.x / 2);
    var resy = Math.round(this.resolution.y / 2);

    var params = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat
    };

    this.renderTargetBright = new THREE.WebGLRenderTarget(resx, resy, params);
    for (var i = 0; i < this.nMips; i++) {
      var rtH = new THREE.WebGLRenderTarget(resx, resy, params);
      var rtV = new THREE.WebGLRenderTarget(resx, resy, params);
      this.renderTargetsHorizontal.push(rtH);
      this.renderTargetsVertical.push(rtV);
      resx = Math.round(resx / 2);
      resy = Math.round(resy / 2);
    }

    // Material for luminosity pass
    var highPassShader = THREE.LuminosityHighPassShader;
    this.highPassUniforms = THREE.UniformsUtils.clone(highPassShader.uniforms);
    this.highPassUniforms.luminosityThreshold.value = threshold;
    this.highPassUniforms.smoothWidth.value = 0.01;
    this.materialHighPassFilter = new THREE.ShaderMaterial({
      uniforms: this.highPassUniforms,
      vertexShader: highPassShader.vertexShader,
      fragmentShader: highPassShader.fragmentShader
    });

    this.separableBlurMaterials = [];
    for (var i = 0; i < this.nMips; i++) {
      this.separableBlurMaterials.push(this._getBlurMaterial());
    }

    this.compositeMaterial = this._getCompositeMaterial(this.nMips);
    this.compositeMaterial.uniforms.blurTexture1.value = this.renderTargetsVertical[0].texture;
    this.compositeMaterial.uniforms.blurTexture2.value = this.renderTargetsVertical[1].texture;
    this.compositeMaterial.uniforms.blurTexture3.value = this.renderTargetsVertical[2].texture;
    this.compositeMaterial.uniforms.bloomStrength.value = strength;

    this.basic = new THREE.MeshBasicMaterial();
    this.copyUniforms = THREE.UniformsUtils.clone(THREE.CopyShader.uniforms);
    this.copyUniforms.opacity.value = 1;
    this.materialCopy = new THREE.ShaderMaterial({
      uniforms: this.copyUniforms,
      vertexShader: THREE.CopyShader.vertexShader,
      fragmentShader: THREE.CopyShader.fragmentShader,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true
    });

    this.enabled = true;
    this.needsSwap = false;
    this.oldClearColor = new THREE.Color();
    this.oldClearAlpha = 1;
    this.fsQuad = new THREE.Pass.FullScreenQuad(null);
  };
  THREE.BloomPass.prototype = Object.assign(Object.create(THREE.Pass.prototype), {
    constructor: THREE.BloomPass,
    setSize: function (width, height) {
      var resx = Math.round(width / 2);
      var resy = Math.round(height / 2);
      this.renderTargetBright.setSize(resx, resy);
      for (var i = 0; i < this.nMips; i++) {
        this.renderTargetsHorizontal[i].setSize(resx, resy);
        this.renderTargetsVertical[i].setSize(resx, resy);
        this.separableBlurMaterials[i].uniforms.texSize.value = new THREE.Vector2(resx, resy);
        resx = Math.round(resx / 2);
        resy = Math.round(resy / 2);
      }
    },
    render: function (renderer, writeBuffer, readBuffer) {
      renderer.getClearColor(this.oldClearColor);
      this.oldClearAlpha = renderer.getClearAlpha();
      var oldAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setClearColor(new THREE.Color(0, 0, 0), 0);

      // High-pass: only bright pixels
      this.highPassUniforms.tDiffuse.value = readBuffer.texture;
      this.fsQuad.material = this.materialHighPassFilter;
      renderer.setRenderTarget(this.renderTargetBright);
      renderer.clear();
      this.fsQuad.render(renderer);

      var inputRenderTarget = this.renderTargetBright;
      for (var i = 0; i < this.nMips; i++) {
        this.fsQuad.material = this.separableBlurMaterials[i];
        this.separableBlurMaterials[i].uniforms.colorTexture.value = inputRenderTarget.texture;
        this.separableBlurMaterials[i].uniforms.direction.value = new THREE.Vector2(1, 0);
        renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
        renderer.clear();
        this.fsQuad.render(renderer);

        this.separableBlurMaterials[i].uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
        this.separableBlurMaterials[i].uniforms.direction.value = new THREE.Vector2(0, 1);
        renderer.setRenderTarget(this.renderTargetsVertical[i]);
        renderer.clear();
        this.fsQuad.render(renderer);

        inputRenderTarget = this.renderTargetsVertical[i];
      }

      // Composite bloom back additively
      this.fsQuad.material = this.compositeMaterial;
      renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
      renderer.clear();
      this.fsQuad.render(renderer);

      this.fsQuad.material = this.materialCopy;
      this.copyUniforms.tDiffuse.value = this.renderTargetsHorizontal[0].texture;

      if (this.renderToScreen) {
        renderer.setRenderTarget(null);
        this.fsQuad.render(renderer);
      } else {
        renderer.setRenderTarget(readBuffer);
        this.fsQuad.render(renderer);
      }

      renderer.setClearColor(this.oldClearColor, this.oldClearAlpha);
      renderer.autoClear = oldAutoClear;
    },
    _getBlurMaterial: function () {
      return new THREE.ShaderMaterial({
        defines: { KERNEL_RADIUS: 3, SIGMA: 3 },
        uniforms: {
          colorTexture: { value: null },
          texSize: { value: new THREE.Vector2(0.5, 0.5) },
          direction: { value: new THREE.Vector2(0.5, 0.5) }
        },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `
          uniform sampler2D colorTexture;
          uniform vec2 texSize;
          uniform vec2 direction;
          varying vec2 vUv;
          float gaussianPdf(in float x, in float sigma) {
            return 0.39894 * exp(-0.5 * x * x / (sigma * sigma)) / sigma;
          }
          void main() {
            vec2 invSize = 1.0 / texSize;
            float fSigma = float(SIGMA);
            float weightSum = gaussianPdf(0.0, fSigma);
            vec3 diffuseSum = texture2D(colorTexture, vUv).rgb * weightSum;
            for (int i = 1; i < KERNEL_RADIUS; i++) {
              float x = float(i);
              float w = gaussianPdf(x, fSigma);
              vec2 uvOffset = direction * invSize * x;
              vec3 s1 = texture2D(colorTexture, vUv + uvOffset).rgb;
              vec3 s2 = texture2D(colorTexture, vUv - uvOffset).rgb;
              diffuseSum += (s1 + s2) * w;
              weightSum += 2.0 * w;
            }
            gl_FragColor = vec4(diffuseSum / weightSum, 1.0);
          }`
      });
    },
    _getCompositeMaterial: function (nMips) {
      return new THREE.ShaderMaterial({
        defines: { NUM_MIPS: nMips },
        uniforms: {
          blurTexture1: { value: null },
          blurTexture2: { value: null },
          blurTexture3: { value: null },
          bloomStrength: { value: 1.0 },
          bloomFactors: { value: [1.0, 0.8, 0.6] },
          bloomTintColors: { value: [
            new THREE.Vector3(1,1,1),
            new THREE.Vector3(1,1,1),
            new THREE.Vector3(1,1,1)
          ]},
          bloomRadius: { value: 0.0 }
        },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `
          varying vec2 vUv;
          uniform sampler2D blurTexture1;
          uniform sampler2D blurTexture2;
          uniform sampler2D blurTexture3;
          uniform float bloomStrength;
          uniform float bloomRadius;
          uniform float bloomFactors[NUM_MIPS];
          uniform vec3 bloomTintColors[NUM_MIPS];
          float lerpBloomFactor(const in float factor) {
            float mirrorFactor = 1.2 - factor;
            return mix(factor, mirrorFactor, bloomRadius);
          }
          void main() {
            gl_FragColor = bloomStrength * (
              lerpBloomFactor(bloomFactors[0]) * vec4(bloomTintColors[0], 1.0) * texture2D(blurTexture1, vUv) +
              lerpBloomFactor(bloomFactors[1]) * vec4(bloomTintColors[1], 1.0) * texture2D(blurTexture2, vUv) +
              lerpBloomFactor(bloomFactors[2]) * vec4(bloomTintColors[2], 1.0) * texture2D(blurTexture3, vUv)
            );
          }`
      });
    }
  });

})();

/* -------------------------------------------------------------
   MAIN SCENE
   ------------------------------------------------------------- */

function isWebGLAvailable(){
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
    return !!(gl && window.WebGLRenderingContext);
  } catch (e) {
    return false;
  }
}

function activateVideoFallback(reason){
  if (reason) console.warn('[PhysMind] WebGL unavailable, using video fallback:', reason);
  const canvas = document.getElementById('heroFx');
  const video  = document.getElementById('heroFallback');
  const loader = document.getElementById('loader');
  if (canvas) canvas.style.display = 'none';
  if (loader) loader.style.display = 'none';
  if (video){
    /* Inject sources lazily so browser doesn't prefetch the video when WebGL works */
    const webm = document.createElement('source');
    webm.src = 'factory-fallback.webm'; webm.type = 'video/webm';
    const mp4  = document.createElement('source');
    mp4.src  = 'factory-fallback.mp4';  mp4.type  = 'video/mp4';
    video.appendChild(webm);
    video.appendChild(mp4);
    video.style.display = 'block';
    video.load();
    video.play().catch(() => { /* autoplay may be blocked; muted+playsinline usually passes */ });
  }
}

if (!isWebGLAvailable()){
  activateVideoFallback('detection failed');
} else (function(){
  const canvas = document.getElementById('heroFx');
  const loader = document.getElementById('loader');
  const parent = canvas.parentElement;
  let W = parent.clientWidth || 560;
  let H = parent.clientHeight || 700;
  canvas.width = W;
  canvas.height = H;

  // -----------------------------------------------
  // Renderer (wrapped in try/catch — fallback if context creation fails)
  // -----------------------------------------------
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: true, powerPreference: 'default',
      failIfMajorPerformanceCaveat: false
    });
  } catch (err){
    activateVideoFallback(err.message);
    return;
  }
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 2.2;
  renderer.physicallyCorrectLights = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // -----------------------------------------------
  // Scene & camera
  // -----------------------------------------------
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x1a2d42, 0.018);

  const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 200);

  // -----------------------------------------------
  // Environment map (procedural gradient, for metal reflections)
  // -----------------------------------------------
  const pmremGen = new THREE.PMREMGenerator(renderer);
  pmremGen.compileEquirectangularShader();

  // Build a procedural env texture
  function buildEnvTexture(){
    const size = 256;
    const rt = new THREE.WebGLCubeRenderTarget(size, {
      format: THREE.RGBFormat,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter
    });
    const cubeCamera = new THREE.CubeCamera(0.1, 100, rt);
    const envScene = new THREE.Scene();

    // Gradient background sphere
    const envGeo = new THREE.SphereGeometry(50, 32, 16);
    const envMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {},
      vertexShader: 'varying vec3 vWP; void main(){ vWP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        varying vec3 vWP;
        void main(){
          float h = normalize(vWP).y;
          vec3 top = vec3(0.18, 0.26, 0.36);
          vec3 mid = vec3(0.10, 0.18, 0.26);
          vec3 bot = vec3(0.06, 0.11, 0.18);
          vec3 col = mix(bot, mid, smoothstep(-0.3, 0.0, h));
          col = mix(col, top, smoothstep(0.0, 0.6, h));
          /* soft mint glow at top */
          col += vec3(0.22, 0.42, 0.36) * smoothstep(0.3, 0.9, h) * 0.35;
          gl_FragColor = vec4(col, 1.0);
        }
      `
    });
    envScene.add(new THREE.Mesh(envGeo, envMat));

    cubeCamera.position.set(0, 0, 0);
    cubeCamera.update(renderer, envScene);
    return rt.texture;
  }
  const envTex = buildEnvTexture();
  scene.environment = envTex;

  // -----------------------------------------------
  // Lights (three-point + accent + floor bounce)
  // -----------------------------------------------
  scene.add(new THREE.HemisphereLight(0xaaeefd, 0x0a1418, 0.9));

  const keyLight = new THREE.DirectionalLight(0xaaeefd, 3.0);
  keyLight.position.set(5, 12, 6);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 35;
  keyLight.shadow.camera.left = -10;
  keyLight.shadow.camera.right = 10;
  keyLight.shadow.camera.top = 10;
  keyLight.shadow.camera.bottom = -10;
  keyLight.shadow.bias = -0.0005;
  keyLight.shadow.radius = 3;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x9ec1ff, 1.2);
  rimLight.position.set(-6, 3, -5);
  scene.add(rimLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 1.0);
  fillLight.position.set(-3, 6, 8);
  scene.add(fillLight);

  const floorBounce = new THREE.DirectionalLight(0x7ad9be, 0.6);
  floorBounce.position.set(0, -3, 0);
  scene.add(floorBounce);

  // -----------------------------------------------
  // Floor — reflective dark with glowing grid
  // -----------------------------------------------
  const floorGeo = new THREE.PlaneGeometry(60, 60);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x1f2f3e,
    roughness: 0.25,
    metalness: 0.85,
    envMap: envTex,
    envMapIntensity: 0.8
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Glowing grid texture on floor
  function makeGridTexture(size, divisions) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(34,229,168,0.35)';
    ctx.lineWidth = 2;
    const step = size / divisions;
    for (let i = 0; i <= divisions; i++) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0); ctx.lineTo(i * step, size);
      ctx.moveTo(0, i * step); ctx.lineTo(size, i * step);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 6);
    return tex;
  }
  const gridTex = makeGridTexture(512, 8);
  const gridGeo = new THREE.PlaneGeometry(60, 60);
  const gridMat = new THREE.MeshBasicMaterial({
    map: gridTex, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending
  });
  const gridMesh = new THREE.Mesh(gridGeo, gridMat);
  gridMesh.rotation.x = -Math.PI / 2;
  gridMesh.position.y = 0.01;
  scene.add(gridMesh);

  // Fade-out radial overlay on floor (distance fade to fog)
  const radialCanvas = document.createElement('canvas');
  radialCanvas.width = radialCanvas.height = 256;
  const rctx = radialCanvas.getContext('2d');
  const rgrad = rctx.createRadialGradient(128, 128, 20, 128, 128, 128);
  rgrad.addColorStop(0, 'rgba(0,0,0,0)');
  rgrad.addColorStop(1, 'rgba(2,7,8,1)');
  rctx.fillStyle = rgrad;
  rctx.fillRect(0, 0, 256, 256);
  const radialTex = new THREE.CanvasTexture(radialCanvas);
  const radialMat = new THREE.MeshBasicMaterial({ map: radialTex, transparent: true, depthWrite: false });
  const radialOverlay = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), radialMat);
  radialOverlay.rotation.x = -Math.PI / 2;
  radialOverlay.position.y = 0.015;
  scene.add(radialOverlay);

  // -----------------------------------------------
  // RoundedBoxGeometry helper (for beveled edges)
  // -----------------------------------------------
  function roundedBox(w, h, d, radius, segments){
    segments = segments || 4;
    radius = Math.min(radius, w/2, h/2, d/2);
    const shape = new THREE.Shape();
    const x = -w/2, y = -h/2;
    shape.moveTo(x + radius, y);
    shape.lineTo(x + w - radius, y);
    shape.quadraticCurveTo(x + w, y, x + w, y + radius);
    shape.lineTo(x + w, y + h - radius);
    shape.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    shape.lineTo(x + radius, y + h);
    shape.quadraticCurveTo(x, y + h, x, y + h - radius);
    shape.lineTo(x, y + radius);
    shape.quadraticCurveTo(x, y, x + radius, y);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: d,
      bevelEnabled: true,
      bevelThickness: radius * 0.5,
      bevelSize: radius * 0.5,
      bevelOffset: 0,
      bevelSegments: segments
    });
    geo.translate(0, 0, -d/2);
    return geo;
  }

  // -----------------------------------------------
  // Material library (shared for consistency)
  // -----------------------------------------------
  const matDarkMetal = new THREE.MeshPhysicalMaterial({
    color: 0x6b7a88, roughness: 0.4, metalness: 0.75,
    envMap: envTex, envMapIntensity: 1.0,
    clearcoat: 0.3, clearcoatRoughness: 0.4
  });
  const matMidMetal = new THREE.MeshPhysicalMaterial({
    color: 0x7f8a94, roughness: 0.3, metalness: 0.82,
    envMap: envTex, envMapIntensity: 1.2,
    clearcoat: 0.4, clearcoatRoughness: 0.3
  });
  const matPlastic = new THREE.MeshPhysicalMaterial({
    color: 0x4a5b6b, roughness: 0.55, metalness: 0.15,
    envMap: envTex, envMapIntensity: 0.6
  });
  const matGlow = function(hex){
    return new THREE.MeshStandardMaterial({
      color: hex, emissive: hex, emissiveIntensity: 1.3,
      roughness: 0.2, metalness: 0.1
    });
  };

  // -----------------------------------------------
  // PhysMind AI Core
  // -----------------------------------------------
  const aiGroup = new THREE.Group();
  aiGroup.position.set(0, 7.5, 0);
  scene.add(aiGroup);

  // Brain neural cluster — 130 neurons in ellipsoidal distribution, organic web
  const NN_NEURON_COUNT = 130;
  const NN_BRAIN_RX = 2.0, NN_BRAIN_RY = 1.5, NN_BRAIN_RZ = 1.65;
  const NN_K_NEAREST = 4;

  const nnNodeGeo = new THREE.SphereGeometry(0.065, 10, 8);
  const nnNodes = []; // { mesh, mat, pos, connIds[], activation }

  for (let i = 0; i < NN_NEURON_COUNT; i++){
    // Rejection sample inside unit sphere for uniform density
    let x, y, z, r2;
    do {
      x = (Math.random() - 0.5) * 2;
      y = (Math.random() - 0.5) * 2;
      z = (Math.random() - 0.5) * 2;
      r2 = x*x + y*y + z*z;
    } while (r2 > 1);
    // Slight center bias for denser core
    const bias = 0.8 + Math.random() * 0.2;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x7ad9be, emissive: 0x7ad9be, emissiveIntensity: 0.25,
      roughness: 0.3, metalness: 0.2
    });
    const mesh = new THREE.Mesh(nnNodeGeo, mat);
    mesh.position.set(x * NN_BRAIN_RX * bias, y * NN_BRAIN_RY * bias, z * NN_BRAIN_RZ * bias);
    aiGroup.add(mesh);
    nnNodes.push({ mesh, mat, pos: mesh.position.clone(), connIds: [], activation: 0 });
  }

  // Build organic connections via k-nearest neighbors (dedup pairs)
  const nnConnections = [];
  const nnLineVerts = [];
  const pairSet = new Set();
  for (let i = 0; i < NN_NEURON_COUNT; i++){
    const dists = [];
    for (let j = 0; j < NN_NEURON_COUNT; j++){
      if (i === j) continue;
      dists.push({ j, d: nnNodes[i].pos.distanceTo(nnNodes[j].pos) });
    }
    dists.sort((a, b) => a.d - b.d);
    for (let k = 0; k < NN_K_NEAREST; k++){
      const j = dists[k].j;
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (pairSet.has(key)) continue;
      pairSet.add(key);
      const src = nnNodes[i].pos, dst = nnNodes[j].pos;
      const connIdx = nnConnections.length;
      nnConnections.push({
        aIdx: i, bIdx: j,
        sx: src.x, sy: src.y, sz: src.z,
        dx: dst.x, dy: dst.y, dz: dst.z
      });
      nnNodes[i].connIds.push(connIdx);
      nnNodes[j].connIds.push(connIdx);
      nnLineVerts.push(src.x, src.y, src.z, dst.x, dst.y, dst.z);
    }
  }
  const nnLineGeo = new THREE.BufferGeometry();
  nnLineGeo.setAttribute('position', new THREE.Float32BufferAttribute(nnLineVerts, 3));
  const nnLineMat = new THREE.LineBasicMaterial({
    color: 0x7ad9be, transparent: true, opacity: 0.3
  });
  const nnLines = new THREE.LineSegments(nnLineGeo, nnLineMat);
  aiGroup.add(nnLines);

  // Signal particles — nerve impulses wandering the web
  const NN_SIGNAL_COUNT = 55;
  const nnSignals = [];
  for (let i = 0; i < NN_SIGNAL_COUNT; i++){
    const connIdx = Math.floor(Math.random() * nnConnections.length);
    nnSignals.push({
      connIdx,
      progress: Math.random(),
      speed: 0.5 + Math.random() * 0.6,
      forward: Math.random() < 0.5  // which end we're traveling toward
    });
  }
  const nnSigGeo = new THREE.BufferGeometry();
  const nnSigPos = new Float32Array(NN_SIGNAL_COUNT * 3);
  nnSigGeo.setAttribute('position', new THREE.BufferAttribute(nnSigPos, 3));
  const nnSigMat = new THREE.PointsMaterial({
    color: 0xfff3dc, size: 0.14, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
  });
  const nnSigPoints = new THREE.Points(nnSigGeo, nnSigMat);
  aiGroup.add(nnSigPoints);

  // Color blend helpers for neuron firing
  const nnBaseColor = new THREE.Color(0x7ad9be);
  const nnWarmColor = new THREE.Color(0xfff3dc);

  // Strong point light at core (casts shadows too)
  const aiPointLight = new THREE.PointLight(0x7ad9be, 4, 20, 1.5);
  aiPointLight.castShadow = true;
  aiPointLight.shadow.mapSize.set(512, 512);
  aiGroup.add(aiPointLight);


  // -----------------------------------------------
  // Cell builder (platform with beveled base + accent rim + label plate)
  // -----------------------------------------------
  /* Shared radial contact-shadow texture */
  const contactCanvas = document.createElement('canvas');
  contactCanvas.width = contactCanvas.height = 256;
  const cctx = contactCanvas.getContext('2d');
  const ccGrad = cctx.createRadialGradient(128, 128, 20, 128, 128, 124);
  ccGrad.addColorStop(0, 'rgba(0,0,0,0.75)');
  ccGrad.addColorStop(0.5, 'rgba(0,0,0,0.35)');
  ccGrad.addColorStop(1, 'rgba(0,0,0,0)');
  cctx.fillStyle = ccGrad;
  cctx.fillRect(0, 0, 256, 256);
  const contactShadowTex = new THREE.CanvasTexture(contactCanvas);

  function buildCellBase(x, z, accentHex){
    const g = new THREE.Group();
    g.position.set(x, 0, z);

    // Contact shadow under cell (stronger, closer than lightmap shadow)
    const shadowMat = new THREE.MeshBasicMaterial({
      map: contactShadowTex, transparent: true,
      depthWrite: false, opacity: 0.9
    });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(7, 6), shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    g.add(shadow);

    // Base block with bevel
    const baseGeo = roundedBox(4.2, 0.6, 3.6, 0.15, 4);
    baseGeo.rotateX(-Math.PI / 2);
    const base = new THREE.Mesh(baseGeo, matDarkMetal);
    base.position.y = 0.3;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    // Accent rim glow (flat plane under rim edge)
    const rimGeo = new THREE.BoxGeometry(4.05, 0.05, 3.45);
    const rimMat = new THREE.MeshStandardMaterial({
      color: accentHex, emissive: accentHex, emissiveIntensity: 1.8,
      roughness: 0.3, metalness: 0.2
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.y = 0.62;
    g.add(rim);

    // Small glow underside (floor bounce)
    const underGlow = new THREE.PointLight(accentHex, 0.8, 3);
    underGlow.position.y = 0.05;
    g.add(underGlow);

    scene.add(g);
    return g;
  }

  // ═══ Cell 01: Articulated Robot Arm ═══
  const cell1 = buildCellBase(0, -5, 0x7ad9be);

  // Column base
  const armColGeo = new THREE.CylinderGeometry(0.45, 0.55, 1.0, 24);
  const armCol = new THREE.Mesh(armColGeo, matDarkMetal);
  armCol.position.y = 1.1;
  armCol.castShadow = true;
  cell1.add(armCol);

  // Yoke (the part that rotates horizontally)
  const armYoke = new THREE.Group();
  armYoke.position.y = 1.5;
  cell1.add(armYoke);

  const yokeGeo = roundedBox(0.6, 0.5, 1.0, 0.08, 3);
  const yoke = new THREE.Mesh(yokeGeo, matMidMetal);
  yoke.castShadow = true;
  armYoke.add(yoke);

  // Shoulder joint sphere
  const shoulderGeo = new THREE.SphereGeometry(0.32, 20, 16);
  const shoulderM = new THREE.MeshPhysicalMaterial({
    color: 0x8a96a3, roughness: 0.25, metalness: 0.9,
    envMap: envTex, envMapIntensity: 1.4
  });
  const shoulder = new THREE.Mesh(shoulderGeo, shoulderM);
  shoulder.position.y = 0.35;
  armYoke.add(shoulder);

  // Upper arm group (rotates at shoulder)
  const upperArm = new THREE.Group();
  upperArm.position.y = 0.35;
  armYoke.add(upperArm);

  // Tapered upper arm (cylinder with different radii)
  const upperGeo = new THREE.CylinderGeometry(0.18, 0.24, 1.6, 16);
  const upper = new THREE.Mesh(upperGeo, matMidMetal);
  upper.position.y = 0.85;
  upper.castShadow = true;
  upperArm.add(upper);

  // Elbow joint
  const elbow = new THREE.Mesh(shoulderGeo, shoulderM);
  elbow.scale.setScalar(0.7);
  elbow.position.y = 1.65;
  upperArm.add(elbow);

  // Forearm group (rotates at elbow)
  const forearm = new THREE.Group();
  forearm.position.y = 1.65;
  upperArm.add(forearm);

  const foreGeo = new THREE.CylinderGeometry(0.14, 0.18, 1.3, 16);
  const fore = new THREE.Mesh(foreGeo, matMidMetal);
  fore.position.y = 0.65;
  fore.castShadow = true;
  forearm.add(fore);

  // Wrist
  const wrist = new THREE.Mesh(shoulderGeo, shoulderM);
  wrist.scale.setScalar(0.55);
  wrist.position.y = 1.3;
  forearm.add(wrist);

  // Gripper (two fingers)
  const gripGroup = new THREE.Group();
  gripGroup.position.y = 1.3;
  forearm.add(gripGroup);

  const gripBodyGeo = roundedBox(0.3, 0.2, 0.2, 0.04, 2);
  const gripBody = new THREE.Mesh(gripBodyGeo, matMidMetal);
  gripGroup.add(gripBody);
  const fingerGeo = roundedBox(0.06, 0.3, 0.12, 0.02, 2);
  const f1 = new THREE.Mesh(fingerGeo, matGlow(0x7ad9be));
  f1.position.set(-0.12, 0.22, 0);
  gripGroup.add(f1);
  const f2 = new THREE.Mesh(fingerGeo, matGlow(0x7ad9be));
  f2.position.set(0.12, 0.22, 0);
  gripGroup.add(f2);

  // ═══ Cell 02: Precision Vision System ═══
  const cell2 = buildCellBase(0, 0.5, 0x9ec1ff);

  // Pole
  const poleGeo = roundedBox(0.16, 2.6, 0.16, 0.03, 2);
  const pole = new THREE.Mesh(poleGeo, matDarkMetal);
  pole.position.y = 2.0;
  pole.castShadow = true;
  cell2.add(pole);

  // Cross arm
  const armHorzGeo = roundedBox(1.2, 0.15, 0.15, 0.03, 2);
  const armHorz = new THREE.Mesh(armHorzGeo, matDarkMetal);
  armHorz.position.set(0, 3.1, 0);
  cell2.add(armHorz);

  // Camera housing (with bevel)
  const camBoxGeo = roundedBox(0.8, 0.55, 0.55, 0.08, 3);
  const camBox = new THREE.Mesh(camBoxGeo, matMidMetal);
  camBox.position.set(0, 2.75, 0);
  camBox.castShadow = true;
  cell2.add(camBox);

  // Lens barrel
  const lensBarrelGeo = new THREE.CylinderGeometry(0.19, 0.22, 0.35, 24);
  const lensBarrel = new THREE.Mesh(lensBarrelGeo, matDarkMetal);
  lensBarrel.position.set(0, 2.35, 0);
  cell2.add(lensBarrel);

  // Glowing lens
  const lensGeo = new THREE.CylinderGeometry(0.15, 0.17, 0.04, 24);
  const lens = new THREE.Mesh(lensGeo, matGlow(0x9ec1ff));
  lens.position.set(0, 2.17, 0);
  cell2.add(lens);

  // Volumetric scan cone (custom shader for soft volumetric look)
  const beamGeo = new THREE.ConeGeometry(0.6, 1.6, 32, 1, true);
  const beamMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0x9ec1ff) }
    },
    transparent: true, side: THREE.DoubleSide,
    depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec2 vUv; varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        float fade = smoothstep(0.0, 0.6, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
        float edge = smoothstep(0.0, 0.15, abs(vUv.x - 0.5));
        float pulse = 0.7 + 0.3 * sin(uTime * 3.0);
        float alpha = fade * (1.0 - edge) * pulse * 0.5;
        gl_FragColor = vec4(uColor, alpha);
      }`
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.set(0, 1.35, 0);
  beam.rotation.x = Math.PI;
  cell2.add(beam);

  // ═══ Cell 03: Welding / Assembly ═══
  const cell3 = buildCellBase(0, 6, 0xf5c57a);

  const weldBaseGeo = roundedBox(1.2, 0.4, 1.2, 0.1, 3);
  const weldBase = new THREE.Mesh(weldBaseGeo, matDarkMetal);
  weldBase.position.y = 0.85;
  weldBase.castShadow = true;
  cell3.add(weldBase);

  // Articulated torch arm
  const torchShoulder = new THREE.Group();
  torchShoulder.position.y = 1.05;
  cell3.add(torchShoulder);

  const tArm1Geo = new THREE.CylinderGeometry(0.1, 0.12, 1.0, 12);
  const tArm1 = new THREE.Mesh(tArm1Geo, matMidMetal);
  tArm1.position.y = 0.5;
  tArm1.rotation.z = -0.35;
  tArm1.castShadow = true;
  torchShoulder.add(tArm1);

  const tElbow = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 12, 10), matMidMetal
  );
  tElbow.position.set(-0.34, 0.95, 0);
  torchShoulder.add(tElbow);

  const tArm2Geo = new THREE.CylinderGeometry(0.08, 0.1, 0.7, 12);
  const tArm2 = new THREE.Mesh(tArm2Geo, matMidMetal);
  tArm2.position.set(-0.62, 0.63, 0);
  tArm2.rotation.z = 0.7;
  torchShoulder.add(tArm2);

  // Torch head + tip
  const torchHead = new THREE.Group();
  torchHead.position.set(-0.82, 0.37, 0);
  torchShoulder.add(torchHead);

  const headGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.25, 12);
  const head = new THREE.Mesh(headGeo, matMidMetal);
  head.rotation.z = Math.PI / 2;
  torchHead.add(head);

  // Nozzle (the visible tip - a tapered cone with amber glow inside)
  const nozGeo = new THREE.CylinderGeometry(0.05, 0.08, 0.18, 12);
  const nozMat = new THREE.MeshStandardMaterial({
    color: 0x7c8794, roughness: 0.4, metalness: 0.85,
    emissive: 0xf5c57a, emissiveIntensity: 0.7
  });
  const noz = new THREE.Mesh(nozGeo, nozMat);
  noz.position.set(-0.2, 0, 0);
  noz.rotation.z = Math.PI / 2;
  torchHead.add(noz);

  // Spark particles (GPU-friendly)
  const sparkCount = 50;
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(sparkCount * 3);
  const sparkData = [];
  for (let i = 0; i < sparkCount; i++){
    sparkData.push({
      life: Math.random(),
      vx: 0, vy: 0, vz: 0
    });
  }
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));

  // Sprite-based sparks for nicer bloom
  const sparkCanvas = document.createElement('canvas');
  sparkCanvas.width = sparkCanvas.height = 64;
  const spctx = sparkCanvas.getContext('2d');
  const spgrad = spctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  spgrad.addColorStop(0, 'rgba(255,240,180,1)');
  spgrad.addColorStop(0.3, 'rgba(251,191,36,0.9)');
  spgrad.addColorStop(1, 'rgba(251,191,36,0)');
  spctx.fillStyle = spgrad;
  spctx.fillRect(0, 0, 64, 64);
  const sparkTex = new THREE.CanvasTexture(sparkCanvas);

  const sparkMat = new THREE.PointsMaterial({
    map: sparkTex, size: 0.3, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true
  });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  // tip world position (parent group transforms apply)
  const tipLocal = new THREE.Vector3(-0.3, 0, 0);
  torchHead.add(sparks);

  // Spot light at torch tip for dynamic lighting
  const torchLight = new THREE.PointLight(0xf5c57a, 0, 3, 1.5);
  torchHead.add(torchLight);

  // -----------------------------------------------
  // Conveyor belt (runs front-to-back along Z axis on the right side)
  // -----------------------------------------------
  const BELT_X = 3.8;        // belt sits to the right of the cells
  const BELT_LEN = 18;
  const beltGeo = roundedBox(1.2, 0.3, BELT_LEN, 0.05, 2);
  const belt = new THREE.Mesh(beltGeo, new THREE.MeshPhysicalMaterial({
    color: 0x3b4a5a, roughness: 0.6, metalness: 0.5,
    envMap: envTex, envMapIntensity: 0.6
  }));
  belt.position.set(BELT_X, 0.55, 0);
  belt.receiveShadow = true;
  scene.add(belt);

  // Scrolling stripe texture on top of belt
  const stripeCanvas = document.createElement('canvas');
  stripeCanvas.width = 16; stripeCanvas.height = 256;
  const stctx = stripeCanvas.getContext('2d');
  stctx.fillStyle = '#020708'; stctx.fillRect(0, 0, 16, 256);
  stctx.fillStyle = 'rgba(34,229,168,0.45)';
  for (let i = 0; i < 12; i++){
    stctx.fillRect(6, i * 22, 4, 12);
  }
  const stripeTex = new THREE.CanvasTexture(stripeCanvas);
  stripeTex.wrapS = stripeTex.wrapT = THREE.RepeatWrapping;
  stripeTex.repeat.set(1, 6);
  const stripeMat = new THREE.MeshBasicMaterial({
    map: stripeTex, transparent: true
  });
  const stripeMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, BELT_LEN),
    stripeMat
  );
  stripeMesh.rotation.x = -Math.PI / 2;
  stripeMesh.position.set(BELT_X, 0.71, 0);
  scene.add(stripeMesh);

  // Rails along the belt sides (now oriented along Z)
  for (let side = -1; side <= 1; side += 2){
    const railGeo = new THREE.CylinderGeometry(0.025, 0.025, BELT_LEN, 8);
    const railMat = new THREE.MeshStandardMaterial({
      color: 0x7ad9be, emissive: 0x7ad9be, emissiveIntensity: 0.7,
      roughness: 0.2
    });
    const rail = new THREE.Mesh(railGeo, railMat);
    /* default cylinder axis is Y; rotate to align with Z */
    rail.rotation.x = Math.PI / 2;
    rail.position.set(BELT_X + side * 0.6, 0.73, 0);
    scene.add(rail);
  }

  // Parts on belt (flow along Z)
  const partCount = 10;
  const parts = [];
  const partMats = [
    new THREE.MeshPhysicalMaterial({
      color: 0x3a7a72, emissive: 0x7ad9be, emissiveIntensity: 0.2,
      roughness: 0.4, metalness: 0.7, envMap: envTex, envMapIntensity: 0.8
    }),
    new THREE.MeshPhysicalMaterial({
      color: 0x3a5e7a, emissive: 0x9ec1ff, emissiveIntensity: 0.2,
      roughness: 0.4, metalness: 0.7, envMap: envTex, envMapIntensity: 0.8
    }),
    new THREE.MeshPhysicalMaterial({
      color: 0x7a5a3a, emissive: 0xf5c57a, emissiveIntensity: 0.2,
      roughness: 0.4, metalness: 0.7, envMap: envTex, envMapIntensity: 0.8
    })
  ];
  const partGeo = roundedBox(0.5, 0.45, 0.5, 0.06, 2);
  for (let i = 0; i < partCount; i++){
    const m = new THREE.Mesh(partGeo, partMats[Math.floor(i / 3.33) % 3]);
    m.castShadow = true;
    m.position.set(BELT_X, 1.0, 0);
    scene.add(m);
    parts.push({ mesh: m, offset: i * 1.8 });
  }

  // -----------------------------------------------
  // Data flow: curved glowing lines + moving packets
  // -----------------------------------------------
  const dataLines = [];
  const aiPos = new THREE.Vector3(0, 7.5, 0);
  const cellTops = [
    new THREE.Vector3(0, 2.0, -5),    // cell1 back
    new THREE.Vector3(0, 3.2,  0.5),  // cell2 middle
    new THREE.Vector3(0, 1.6,  6)     // cell3 front
  ];
  cellTops.forEach((target, i) => {
    const mid = new THREE.Vector3(
      (aiPos.x + target.x) * 0.5,
      Math.max(aiPos.y, target.y) + 0.8,
      (aiPos.z + target.z) * 0.5
    );
    const curve = new THREE.QuadraticBezierCurve3(aiPos, mid, target);
    const pts = curve.getPoints(40);

    // Tube geometry (gives real thickness, catches bloom)
    const tubeGeo = new THREE.TubeGeometry(curve, 40, 0.018, 6, false);
    const tubeMat = new THREE.MeshBasicMaterial({
      color: 0x7ad9be, transparent: true, opacity: 0.45
    });
    const tube = new THREE.Mesh(tubeGeo, tubeMat);
    scene.add(tube);

    // Packets — 3 per line staggered
    const packets = [];
    for (let p = 0; p < 3; p++){
      const pktGeo = new THREE.SphereGeometry(0.09, 12, 10);
      const pktMat = new THREE.MeshBasicMaterial({ color: 0x7ad9be });
      const pkt = new THREE.Mesh(pktGeo, pktMat);
      scene.add(pkt);
      packets.push({ mesh: pkt, phase: p / 3 + i * 0.15 });
    }
    dataLines.push({ curve, packets });
  });

  // -----------------------------------------------
  // Post-processing
  // -----------------------------------------------
  const composer = new THREE.EffectComposer(renderer);
  const renderPass = new THREE.RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloomPass = new THREE.BloomPass(1.0, 25, 0.75, new THREE.Vector2(W, H));
  bloomPass.compositeMaterial.uniforms.bloomRadius.value = 0.5;
  composer.addPass(bloomPass);

  // Custom: vignette + grain + chromatic aberration + edge softening
  const FinalShader = {
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uVignette: { value: 1.05 },
      uGrain: { value: 0.055 },
      uCA: { value: 0.0022 },
      uRes: { value: new THREE.Vector2(W, H) }
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float uTime;
      uniform float uVignette;
      uniform float uGrain;
      uniform float uCA;
      uniform vec2  uRes;
      varying vec2 vUv;
      float hash(vec2 p){
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      /* 5-tap gaussian for subtle edge blur (cinematic softening) */
      vec3 edgeBlur(vec2 uv, float amt){
        vec2 px = amt / uRes;
        vec3 c = texture2D(tDiffuse, uv).rgb * 0.4;
        c += texture2D(tDiffuse, uv + vec2( px.x, 0)).rgb * 0.15;
        c += texture2D(tDiffuse, uv + vec2(-px.x, 0)).rgb * 0.15;
        c += texture2D(tDiffuse, uv + vec2(0,  px.y)).rgb * 0.15;
        c += texture2D(tDiffuse, uv + vec2(0, -px.y)).rgb * 0.15;
        return c;
      }
      void main(){
        vec2 uv = vUv;
        vec2 center = uv - 0.5;
        float dist = length(center);
        /* Chromatic aberration increases toward edges */
        float caAmount = uCA * dist * 4.0;
        float r = texture2D(tDiffuse, uv + center * caAmount).r;
        float g = texture2D(tDiffuse, uv).g;
        float b = texture2D(tDiffuse, uv - center * caAmount).b;
        vec3 color = vec3(r, g, b);
        /* Edge softening — blend sharp center with soft edges */
        float blurK = smoothstep(0.3, 0.7, dist) * 3.0;
        if (blurK > 0.05){
          color = mix(color, edgeBlur(uv, blurK), 0.6);
        }
        /* Grain */
        float grain = (hash(uv * vec2(1024.0) + uTime) - 0.5) * uGrain;
        color += grain;
        /* Vignette */
        float v = 1.0 - dist * uVignette;
        v = smoothstep(0.0, 1.0, v);
        /* Warmer tint in highlights, cooler in shadows (subtle teal grade) */
        float lum = dot(color, vec3(0.299, 0.587, 0.114));
        color = mix(color, color * vec3(0.92, 1.05, 1.02), 1.0 - lum);
        color *= v;
        gl_FragColor = vec4(color, 1.0);
      }
    `
  };
  const finalPass = new THREE.ShaderPass(FinalShader);
  finalPass.renderToScreen = true;
  composer.addPass(finalPass);

  // -----------------------------------------------
  // Intro camera animation
  // -----------------------------------------------
  /* Camera traces a cinematic dolly-in along the production line.
     Start: high + far at the front end (z=20), looking back through the cells.
     End: lower + closer (z=14), tilted so all 3 cells + belt are visible. */
  const cameraStart = { pos: new THREE.Vector3(-2, 22, 24), target: new THREE.Vector3(0, 2, 0) };
  const cameraEnd   = { pos: new THREE.Vector3(-6, 7, 14),  target: new THREE.Vector3(1, 2.5, 0) };
  let introStart = null;
  const INTRO_DURATION = 2200;

  function easeInOutCubic(t){ return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2; }

  // -----------------------------------------------
  // Animation loop
  // -----------------------------------------------
  const clock = new THREE.Clock();
  function tick(){
    const t = clock.getElapsedTime();

    // Intro lerp
    if (introStart === null) introStart = performance.now();
    const introP = Math.min(1, (performance.now() - introStart) / INTRO_DURATION);
    const ease = easeInOutCubic(introP);
    const camPos = cameraStart.pos.clone().lerp(cameraEnd.pos, ease);
    const camTgt = cameraStart.target.clone().lerp(cameraEnd.target, ease);

    // Post-intro cinematic drift — camera slowly breathes around end position
    if (introP >= 1){
      const orbT = (t - INTRO_DURATION / 1000) * 0.12;
      camPos.x = cameraEnd.pos.x + Math.sin(orbT) * 1.3;
      camPos.y = cameraEnd.pos.y + Math.sin(orbT * 0.6) * 0.4;
      camPos.z = cameraEnd.pos.z + Math.cos(orbT * 0.9) * 0.8;
    }
    camera.position.copy(camPos);
    camera.lookAt(camTgt);

    // Brain neural cluster — nerve impulses wandering + neuron firing
    const nnDt = Math.min(0.05, t - (tick.lastT || t));
    tick.lastT = t;

    for (let i = 0; i < NN_SIGNAL_COUNT; i++){
      const s = nnSignals[i];
      s.progress += s.speed * nnDt;
      if (s.progress >= 1){
        const c = nnConnections[s.connIdx];
        // End node reached
        const endNodeIdx = s.forward ? c.bIdx : c.aIdx;
        nnNodes[endNodeIdx].activation = 1.0;
        // Pick a new connection from end node (exclude current) — random walk
        const opts = nnNodes[endNodeIdx].connIds;
        let newConnIdx = s.connIdx;
        if (opts.length > 1){
          let tries = 0;
          do {
            newConnIdx = opts[Math.floor(Math.random() * opts.length)];
            tries++;
          } while (newConnIdx === s.connIdx && tries < 4);
        }
        const nc = nnConnections[newConnIdx];
        s.connIdx = newConnIdx;
        s.forward = (nc.aIdx === endNodeIdx);  // we go from aIdx to bIdx or vice versa
        s.progress = 0;
        s.speed = 0.5 + Math.random() * 0.6;
      }
      const c = nnConnections[s.connIdx];
      const sx = s.forward ? c.sx : c.dx;
      const sy = s.forward ? c.sy : c.dy;
      const sz = s.forward ? c.sz : c.dz;
      const ex = s.forward ? c.dx : c.sx;
      const ey = s.forward ? c.dy : c.sy;
      const ez = s.forward ? c.dz : c.sz;
      nnSigPos[i*3]   = sx + (ex - sx) * s.progress;
      nnSigPos[i*3+1] = sy + (ey - sy) * s.progress;
      nnSigPos[i*3+2] = sz + (ez - sz) * s.progress;
    }
    nnSigGeo.attributes.position.needsUpdate = true;

    // Neuron activation decay + warm-color firing + subtle scale pulse
    const nnDecay = Math.pow(0.08, nnDt);
    for (let i = 0; i < nnNodes.length; i++){
      const n = nnNodes[i];
      n.activation *= nnDecay;
      n.mat.emissiveIntensity = 0.25 + n.activation * 2.8;
      n.mat.emissive.copy(nnBaseColor).lerp(nnWarmColor, n.activation * 0.8);
      const s = 1 + n.activation * 0.4;
      n.mesh.scale.setScalar(s);
    }

    // Gentle 3D rotation — brain volume reads organically
    aiGroup.rotation.y = t * 0.08;
    aiGroup.rotation.x = Math.sin(t * 0.11) * 0.12;

    // Arm motion
    armYoke.rotation.y = Math.sin(t * 0.7) * 0.8;
    upperArm.rotation.x = -0.4 + Math.sin(t * 0.7 + 0.5) * 0.3;
    forearm.rotation.x = -0.6 + Math.sin(t * 0.7 + 1.0) * 0.5;

    // Beam shader
    beamMat.uniforms.uTime.value = t;

    // Torch swings slightly
    torchShoulder.rotation.y = Math.sin(t * 0.4) * 0.3;

    // Sparks physics (in torchHead local space)
    for (let i = 0; i < sparkCount; i++){
      sparkData[i].life -= 0.02;
      if (sparkData[i].life <= 0){
        sparkPos[i*3]   = tipLocal.x;
        sparkPos[i*3+1] = tipLocal.y;
        sparkPos[i*3+2] = tipLocal.z;
        sparkData[i].vx = (Math.random() - 0.5) * 0.08 - 0.02;
        sparkData[i].vy = 0.015 + Math.random() * 0.04;
        sparkData[i].vz = (Math.random() - 0.5) * 0.06;
        sparkData[i].life = 0.8 + Math.random() * 0.4;
      }
      sparkPos[i*3]   += sparkData[i].vx;
      sparkPos[i*3+1] += sparkData[i].vy;
      sparkPos[i*3+2] += sparkData[i].vz;
      sparkData[i].vy -= 0.002; // gravity
    }
    sparkGeo.attributes.position.needsUpdate = true;
    // Torch light flickers with sparks
    torchLight.intensity = 2 + Math.sin(t * 12) * 1;

    // Belt stripe scrolls (along Z axis now, which is texture Y)
    stripeTex.offset.y = -t * 0.8;

    // Parts flow along belt (along Z axis now)
    parts.forEach(p => {
      const phase = ((t * 1.5 + p.offset) % 20) - 10;
      p.mesh.position.x = 3.8;
      p.mesh.position.z = phase;
      p.mesh.rotation.y = phase * 0.2;
    });

    // Data packets flow
    dataLines.forEach(dl => {
      dl.packets.forEach(pkt => {
        const phase = ((t * 0.35 + pkt.phase) % 1);
        pkt.mesh.position.copy(dl.curve.getPointAt(phase));
        // Grow/shrink along path (visible when in middle, small at endpoints)
        const sc = 0.3 + Math.sin(phase * Math.PI) * 0.9;
        pkt.mesh.scale.setScalar(sc);
      });
    });

    // Final pass updates
    finalPass.uniforms.uTime.value = t;

    composer.render();
    requestAnimationFrame(tick);
  }

  // Hide loader once first frame done
  setTimeout(() => { if (loader) loader.classList.add('hidden'); }, 300);

  tick();

  // Resize handling (listens to window + container size changes)
  function resize(){
    W = parent.clientWidth || W;
    H = parent.clientHeight || H;
    canvas.width = W;
    canvas.height = H;
    renderer.setSize(W, H);
    composer.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver){
    new ResizeObserver(resize).observe(parent);
  }

})();
