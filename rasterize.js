/* rasterize.js - updated for Parts 2-4: textured, lighting+texture blending, transparency */

/* GLOBAL CONSTANTS AND VARIABLES */

/* assignment specific globals */
const INPUT_TRIANGLES_URL = "https://ncsucgclass.github.io/prog4/triangles.json"; // triangles file loc
var defaultEye = vec3.fromValues(0.5,0.5,-0.5); // default eye position in world space
var defaultCenter = vec3.fromValues(0.5,0.5,0.5); // default view direction in world space
var defaultUp = vec3.fromValues(0,1,0); // default view up vector
var lightAmbient = vec3.fromValues(1,1,1); // default light ambient emission
var lightDiffuse = vec3.fromValues(1,1,1); // default light diffuse emission
var lightSpecular = vec3.fromValues(1,1,1); // default light specular emission
var lightPosition = vec3.fromValues(-0.5,1.5,-0.5); // default light position
var rotateTheta = Math.PI/50; // how much to rotate models by with each key press

/* webgl and geometry data */
var gl = null; // the all powerful gl object. It's all here folks!
var inputTriangles = []; // the triangle data as loaded from input files
var numTriangleSets = 0; // how many triangle sets in input scene
var vertexBuffers = []; // this contains vertex coordinate lists by set, in triples
var normalBuffers = []; // this contains normal component lists by set, in triples
var texCoordBuffers = []; // UV buffers per set
var textureObjects = []; // WebGL textures per set
var triSetSizes = []; // this contains the size of each triangle set
var triangleBuffers = []; // lists of indices into vertexBuffers by set, in triples
var textureURLs = []; // raw texture urls recorded per set
var viewDelta = 0; // how much to displace view with each key press

/* shader parameter locations */
var vPosAttribLoc; // where to put position for vertex shader
var vNormAttribLoc; // where to put normal in vertex shader
var vTexAttribLoc; // where to put texcoord in vertex shader
var mMatrixULoc; // where to put model matrix for vertex shader
var pvmMatrixULoc; // where to put project model view matrix for vertex shader
var ambientULoc; // where to put ambient reflecivity for fragment shader
var diffuseULoc; // where to put diffuse reflecivity for fragment shader
var specularULoc; // where to put specular reflecivity for fragment shader
var shininessULoc; // where to put specular exponent for fragment shader
var eyePositionULoc; // location of eye uniform
var blendModeULoc; // location of blend mode uniform
var textureULoc; // location of sampler2D
var materialAlphaULoc; // location of material alpha

/* interaction variables */
var Eye = vec3.clone(defaultEye); // eye position in world space
var Center = vec3.clone(defaultCenter); // view direction in world space
var Up = vec3.clone(defaultUp); // view up vector in world space

/* rendering controls */
var blendMode = 1; // 0 = REPLACE (texture only), 1 = MODULATE (texture * lighting)
var transparentMask = []; // boolean per set: whether it should be treated as transparent

// ASSIGNMENT HELPER FUNCTIONS

// get the JSON file from the passed URL
function getJSONFile(url,descr) {
    try {
        if ((typeof(url) !== "string") || (typeof(descr) !== "string"))
            throw "getJSONFile: parameter not a string";
        else {
            var httpReq = new XMLHttpRequest(); // a new http request
            httpReq.open("GET",url,false); // init the request
            httpReq.send(null); // send the request
            var startTime = Date.now();
            while ((httpReq.status !== 200) && (httpReq.readyState !== XMLHttpRequest.DONE)) {
                if ((Date.now()-startTime) > 3000)
                    break;
            } // until its loaded or we time out after three seconds
            if ((httpReq.status !== 200) || (httpReq.readyState !== XMLHttpRequest.DONE))
                throw "Unable to open "+descr+" file!";
            else
                return JSON.parse(httpReq.response); 
        } // end if good params
    } // end try    
    
    catch(e) {
        console.log(e);
        return(String.null);
    }
} // end get input json file

// does stuff when keys are pressed
function handleKeyDown(event) {
    
    const modelEnum = {TRIANGLES: "triangles", ELLIPSOID: "ellipsoid"}; // enumerated model type
    const dirEnum = {NEGATIVE: -1, POSITIVE: 1}; // enumerated rotation direction
    
    function highlightModel(modelType,whichModel) {
        if (handleKeyDown.modelOn != null)
            handleKeyDown.modelOn.on = false;
        handleKeyDown.whichOn = whichModel;
        if (modelType == modelEnum.TRIANGLES)
            handleKeyDown.modelOn = inputTriangles[whichModel]; 
        else
            handleKeyDown.modelOn = inputEllipsoids[whichModel]; 
        handleKeyDown.modelOn.on = true; 
    } // end highlight model
    
    function translateModel(offset) {
        if (handleKeyDown.modelOn != null)
            vec3.add(handleKeyDown.modelOn.translation,handleKeyDown.modelOn.translation,offset);
    } // end translate model

    function rotateModel(axis,direction) {
        if (handleKeyDown.modelOn != null) {
            var newRotation = mat4.create();

            mat4.fromRotation(newRotation,direction*rotateTheta,axis); // get a rotation matrix around passed axis
            vec3.transformMat4(handleKeyDown.modelOn.xAxis,handleKeyDown.modelOn.xAxis,newRotation); // rotate model x axis tip
            vec3.transformMat4(handleKeyDown.modelOn.yAxis,handleKeyDown.modelOn.yAxis,newRotation); // rotate model y axis tip
        } // end if there is a highlighted model
    } // end rotate model
    
    // set up needed view params
    var lookAt = vec3.create(), viewRight = vec3.create(), temp = vec3.create(); // lookat, right & temp vectors
    lookAt = vec3.normalize(lookAt,vec3.subtract(temp,Center,Eye)); // get lookat vector
    viewRight = vec3.normalize(viewRight,vec3.cross(temp,lookAt,Up)); // get view right vector
    
    // highlight static variables
    handleKeyDown.whichOn = handleKeyDown.whichOn == undefined ? -1 : handleKeyDown.whichOn; // nothing selected initially
    handleKeyDown.modelOn = handleKeyDown.modelOn == undefined ? null : handleKeyDown.modelOn; // nothing selected initially

    switch (event.code) {
        
        // model selection
        case "Space": 
            if (handleKeyDown.modelOn != null)
                handleKeyDown.modelOn.on = false; // turn off highlighted model
            handleKeyDown.modelOn = null; // no highlighted model
            handleKeyDown.whichOn = -1; // nothing highlighted
            break;
        case "ArrowRight": // select next triangle set
            highlightModel(modelEnum.TRIANGLES,(handleKeyDown.whichOn+1) % numTriangleSets);
            break;
        case "ArrowLeft": // select previous triangle set
            highlightModel(modelEnum.TRIANGLES,(handleKeyDown.whichOn > 0) ? handleKeyDown.whichOn-1 : numTriangleSets-1);
            break;
        // view change
        case "KeyA": // translate view left, rotate left with shift
            Center = vec3.add(Center,Center,vec3.scale(temp,viewRight,viewDelta));
            if (!event.getModifierState("Shift"))
                Eye = vec3.add(Eye,Eye,vec3.scale(temp,viewRight,viewDelta));
            break;
        case "KeyD": // translate view right, rotate right with shift
            Center = vec3.add(Center,Center,vec3.scale(temp,viewRight,-viewDelta));
            if (!event.getModifierState("Shift"))
                Eye = vec3.add(Eye,Eye,vec3.scale(temp,viewRight,-viewDelta));
            break;
        case "KeyS": // translate view backward, rotate up with shift
            if (event.getModifierState("Shift")) {
                Center = vec3.add(Center,Center,vec3.scale(temp,Up,viewDelta));
                Up = vec3.cross(Up,viewRight,vec3.subtract(lookAt,Center,Eye)); /* global side effect */
            } else {
                Eye = vec3.add(Eye,Eye,vec3.scale(temp,lookAt,-viewDelta));
                Center = vec3.add(Center,Center,vec3.scale(temp,lookAt,-viewDelta));
            } // end if shift not pressed
            break;
        case "KeyW": // translate view forward, rotate down with shift
            if (event.getModifierState("Shift")) {
                Center = vec3.add(Center,Center,vec3.scale(temp,Up,-viewDelta));
                Up = vec3.cross(Up,viewRight,vec3.subtract(lookAt,Center,Eye)); /* global side effect */
            } else {
                Eye = vec3.add(Eye,Eye,vec3.scale(temp,lookAt,viewDelta));
                Center = vec3.add(Center,Center,vec3.scale(temp,lookAt,viewDelta));
            } // end if shift not pressed
            break;
        case "KeyQ": // translate view up, rotate counterclockwise with shift
            if (event.getModifierState("Shift"))
                Up = vec3.normalize(Up,vec3.add(Up,Up,vec3.scale(temp,viewRight,-viewDelta)));
            else {
                Eye = vec3.add(Eye,Eye,vec3.scale(temp,Up,viewDelta));
                Center = vec3.add(Center,Center,vec3.scale(temp,Up,viewDelta));
            } // end if shift not pressed
            break;
        case "KeyE": // translate view down, rotate clockwise with shift
            if (event.getModifierState("Shift"))
                Up = vec3.normalize(Up,vec3.add(Up,Up,vec3.scale(temp,viewRight,viewDelta)));
            else {
                Eye = vec3.add(Eye,Eye,vec3.scale(temp,Up,-viewDelta));
                Center = vec3.add(Center,Center,vec3.scale(temp,Up,-viewDelta));
            } // end if shift not pressed
            break;
        case "Escape": // reset view to default
            Eye = vec3.copy(Eye,defaultEye);
            Center = vec3.copy(Center,defaultCenter);
            Up = vec3.copy(Up,defaultUp);
            break;
            
        // model transformation (kept minimal here)
        case "Backspace": // reset model transforms to default
            for (var whichTriSet=0; whichTriSet<numTriangleSets; whichTriSet++) {
                vec3.set(inputTriangles[whichTriSet].translation,0,0,0);
                vec3.set(inputTriangles[whichTriSet].xAxis,1,0,0);
                vec3.set(inputTriangles[whichTriSet].yAxis,0,1,0);
            } // end for all triangle sets
            break;
    } // end switch
} // end handleKeyDown

// set up the webGL environment
function setupWebGL() {
    
    // Set up keys
    document.onkeydown = handleKeyDown; // call this when key pressed


    var imageCanvas = document.getElementById("myImageCanvas"); // create a 2d canvas
      var cw = imageCanvas.width, ch = imageCanvas.height; 
      imageContext = imageCanvas.getContext("2d"); 
      var bkgdImage = new Image(); 
      bkgdImage.crossOrigin = "Anonymous";
      bkgdImage.src = "https://ncsucgclass.github.io/prog3/sky.jpg";
      bkgdImage.onload = function(){
          var iw = bkgdImage.width, ih = bkgdImage.height;
          imageContext.drawImage(bkgdImage,0,0,iw,ih,0,0,cw,ch);   
     }

     
    // Get the canvas and context
    var canvas = document.getElementById("myWebGLCanvas"); // create a js canvas
    gl = canvas.getContext("webgl"); // get a webgl object from it
    
    try {
      if (gl == null) {
        throw "unable to create gl context -- is your browser gl ready?";
      } else {
        //gl.clearColor(0.0, 0.0, 0.0, 1.0); // use black when we clear the frame buffer
        gl.clearDepth(1.0); // use max when we clear the depth buffer
        gl.enable(gl.DEPTH_TEST); // use hidden surface removal (with zbuffering)
        // enable blending (we'll control depthMask when drawing transparent objects)
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }
    } // end try
    
    catch(e) {
      console.log(e);
    } // end catch
 
} // end setupWebGL

// read models in, load them into webgl buffers and textures
function loadModels() {
    
    inputTriangles = getJSONFile(INPUT_TRIANGLES_URL,"triangles"); // read in the triangle data

    try {
        if (inputTriangles == String.null)
            throw "Unable to load triangles file!";
        else {
            var whichSetVert; // index of vertex in current triangle set
            var whichSetTri; // index of triangle in current triangle set
            var vtxToAdd; // vtx coords to add to the coord array
            var normToAdd; // vtx normal to add to the coord array
            var uvToAdd; // uv to add
            var triToAdd; // tri indices to add to the index array
            var maxCorner = vec3.fromValues(Number.MIN_VALUE,Number.MIN_VALUE,Number.MIN_VALUE); // bbox corner
            var minCorner = vec3.fromValues(Number.MAX_VALUE,Number.MAX_VALUE,Number.MAX_VALUE); // other corner
        
            // process each triangle set to load webgl vertex and triangle buffers
            numTriangleSets = inputTriangles.length; // remember how many tri sets
            for (var whichSet=0; whichSet<numTriangleSets; whichSet++) { // for each tri set
                
                var currSet = inputTriangles[whichSet];

                // set up hilighting, modeling translation and rotation
                currSet.center = vec3.fromValues(0,0,0);  // center point of tri set
                currSet.on = false; // not highlighted
                currSet.translation = vec3.fromValues(0,0,0); // no translation
                currSet.xAxis = vec3.fromValues(1,0,0); // model X axis
                currSet.yAxis = vec3.fromValues(0,1,0); // model Y axis 

                // set up the vertex and normal arrays, define model center and axes
                currSet.glVertices = []; // flat coord list for webgl
                currSet.glNormals = []; // flat normal list for webgl
                currSet.glUVs = []; // flat uv list for webgl

                // NOTE: triangles JSON usually has vertices array of [x,y,z], normals array of [nx,ny,nz], and uvs array of [u,v].
                var numVerts = currSet.vertices.length; // num vertices in tri set
                for (whichSetVert=0; whichSetVert<numVerts; whichSetVert++) { // verts in set
                    vtxToAdd = currSet.vertices[whichSetVert]; // get vertex to add
                    normToAdd = currSet.normals[whichSetVert] || [0,0,1]; // get normal to add (fallback)
                    // UV fallback: many datasets use 'uvs' or 'uv' or store per-vertex 'texcoords'
                    var uvCandidate = null;
                    if (currSet.uvs && currSet.uvs[whichSetVert]) uvCandidate = currSet.uvs[whichSetVert];
                    else if (currSet.uv && currSet.uv[whichSetVert]) uvCandidate = currSet.uv[whichSetVert];
                    else if (currSet.texcoords && currSet.texcoords[whichSetVert]) uvCandidate = currSet.texcoords[whichSetVert];
                    else uvCandidate = [0.0, 0.0];

                    currSet.glVertices.push(vtxToAdd[0],vtxToAdd[1],vtxToAdd[2]); // put coords in set coord list
                    currSet.glNormals.push(normToAdd[0],normToAdd[1],normToAdd[2]); // put normal in set coord list
                    currSet.glUVs.push(uvCandidate[0], uvCandidate[1]); // push u,v

                    vec3.max(maxCorner,maxCorner,vtxToAdd); // update world bounding box corner maxima
                    vec3.min(minCorner,minCorner,vtxToAdd); // update world bounding box corner minima
                    vec3.add(currSet.center,currSet.center,vtxToAdd); // add to ctr sum
                } // end for vertices in set
                vec3.scale(currSet.center,currSet.center,1/numVerts); // avg ctr sum

                // send the vertex coords and normals to webGL
                vertexBuffers[whichSet] = gl.createBuffer(); // init empty webgl set vertex coord buffer
                gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffers[whichSet]); // activate that buffer
                gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(currSet.glVertices),gl.STATIC_DRAW); // data in
                normalBuffers[whichSet] = gl.createBuffer(); // init empty webgl set normal component buffer
                gl.bindBuffer(gl.ARRAY_BUFFER,normalBuffers[whichSet]); // activate that buffer
                gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(currSet.glNormals),gl.STATIC_DRAW); // data in

                // send UV buffer
                texCoordBuffers[whichSet] = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffers[whichSet]);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(currSet.glUVs), gl.STATIC_DRAW);

                // set up the triangle index array, adjusting indices across sets
                currSet.glTriangles = []; // flat index list for webgl
                triSetSizes[whichSet] = currSet.triangles.length; // number of tris in this set
                for (whichSetTri=0; whichSetTri<triSetSizes[whichSet]; whichSetTri++) {
                    triToAdd = currSet.triangles[whichSetTri]; // get tri to add
                    currSet.glTriangles.push(triToAdd[0],triToAdd[1],triToAdd[2]); // put indices in set list
                } // end for triangles in set

                // send the triangle indices to webGL
                triangleBuffers.push(gl.createBuffer()); // init empty triangle index buffer
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triangleBuffers[whichSet]); // activate that buffer
                gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(currSet.glTriangles),gl.STATIC_DRAW); // data in

                // TEXTURE: find candidate texture url in JSON; common names: 'texture', 'image', 'textureFile', inside material
                var texUrl = null;
                if (currSet.texture) texUrl = currSet.texture;
                else if (currSet.image) texUrl = currSet.image;
                else if (currSet.textureFile) texUrl = currSet.textureFile;
                else if (currSet.material && currSet.material.texture) texUrl = currSet.material.texture;
                // If it's just a filename, try to make absolute path relative to NCSU host (common for course assets)
                if (texUrl && texUrl.length > 0 && !texUrl.startsWith("http")) {
                    // try same host as other assets
                    // many tri sets reference relative file names, so allow them directly (browser will request relative to page)
                    // Keep it as given (relative) so developer/student can host or adjust if needed.
                }

                textureURLs[whichSet] = texUrl || null;
                textureObjects[whichSet] = null; // placeholder

                // Mark transparency heuristic: if filename suggests PNG/GIF or material alpha < 1
                var probableTransparent = false;
                if (texUrl && /\.(png|gif)$/i.test(texUrl)) probableTransparent = true;
                if (currSet.material && currSet.material.alpha && currSet.material.alpha < 1.0) probableTransparent = true;
                transparentMask[whichSet] = probableTransparent;

                // load texture asynchronously but store object placeholder
                if (texUrl) {
                    loadTextureForSet(whichSet, texUrl);
                } else {
                    // no texture => create 1x1 white texture to avoid shader failure
                    var whiteTex = gl.createTexture();
                    gl.bindTexture(gl.TEXTURE_2D, whiteTex);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1,1,0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255,255,255,255]));
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                    textureObjects[whichSet] = whiteTex;
                    textureURLs[whichSet] = null;
                }

            } // end for each triangle set 
        
            viewDelta = vec3.length(vec3.subtract(vec3.create(),maxCorner,minCorner)) / 100; // set global
           
        } // end if triangle file loaded
    } // end try 
    
    catch(e) {
        console.log(e);
    } // end catch
} // end load models

// load texture for a particular triangle set index (handles POT vs NPOT)
function loadTextureForSet(setIndex, url) {
    var tex = gl.createTexture();
    textureObjects[setIndex] = tex;
    var img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = function() {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        // flip Y so texture coords align with common conventions in generated UVs
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        // upload image
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

        // heuristic: if image is power-of-two, generate mipmaps; otherwise set clamp & linear
        function isPowerOfTwo(x) { return (x & (x - 1)) === 0; }
        if (isPowerOfTwo(img.width) && isPowerOfTwo(img.height)) {
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        } else {
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        }

        // If filename indicates PNG/GIF, keep transparentMask true; otherwise keep heuristic
        if (/\.(png|gif)$/i.test(url)) {
            transparentMask[setIndex] = true;
        }

        // optional: could detect alpha via canvas readback, but CORS can prevent it; we rely on filename heuristic
    };
    img.onerror = function() {
        console.warn("Failed to load texture image for set " + setIndex + ": " + url);
        // fallback to white texture
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1,1,0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255,255,255,255]));
    };
    img.src = url;
}

// setup the webGL shaders
function setupShaders() {
    
    // define vertex shader in essl using es6 template strings
    var vShaderCode = `
        attribute vec3 aVertexPosition; // vertex position
        attribute vec3 aVertexNormal; // vertex normal
        attribute vec2 aTexCoord; // texture coordinate
        
        uniform mat4 umMatrix; // the model matrix
        uniform mat4 upvmMatrix; // the project view model matrix
        
        varying vec3 vWorldPos; // interpolated world position of vertex
        varying vec3 vVertexNormal; // interpolated normal for frag shader
        varying vec2 vTexCoord; // interpolated tex coord for fragment

        void main(void) {
            
            // vertex position
            vec4 vWorldPos4 = umMatrix * vec4(aVertexPosition, 1.0);
            vWorldPos = vec3(vWorldPos4.x,vWorldPos4.y,vWorldPos4.z);
            gl_Position = upvmMatrix * vec4(aVertexPosition, 1.0);

            // vertex normal (assume no non-uniform scale)
            vec4 vWorldNormal4 = umMatrix * vec4(aVertexNormal, 0.0);
            vVertexNormal = normalize(vec3(vWorldNormal4.x,vWorldNormal4.y,vWorldNormal4.z)); 

            // pass uv through
            vTexCoord = aTexCoord;
        }
    `;
    
    // define fragment shader in essl using es6 template strings
    var fShaderCode = `
        precision mediump float; // set float to medium precision

        // eye location
        uniform vec3 uEyePosition; // the eye's position in world
        
        // light properties
        uniform vec3 uLightAmbient; // the light's ambient color
        uniform vec3 uLightDiffuse; // the light's diffuse color
        uniform vec3 uLightSpecular; // the light's specular color
        uniform vec3 uLightPosition; // the light's position
        
        // material properties
        uniform vec3 uAmbient; // the ambient reflectivity
        uniform vec3 uDiffuse; // the diffuse reflectivity
        uniform vec3 uSpecular; // the specular reflectivity
        uniform float uShininess; // the specular exponent
        uniform float uMaterialAlpha; // material-level alpha multiplier (default 1.0)
        
        // texture and blend mode
        uniform sampler2D uTexture;
        uniform int uBlendMode; // 0 = REPLACE, 1 = MODULATE
        
        // geometry properties
        varying vec3 vWorldPos; // world xyz of fragment
        varying vec3 vVertexNormal; // normal of fragment
        varying vec2 vTexCoord; // uv coordinate
            
        void main(void) {
        
            // SAMPLE TEXTURE
            vec4 Ct = texture2D(uTexture, vTexCoord);

            // ambient term
            vec3 ambient = uAmbient * uLightAmbient; 
            
            // diffuse term
            vec3 normal = normalize(vVertexNormal); 
            vec3 light = normalize(uLightPosition - vWorldPos);
            float lambert = max(0.0,dot(normal,light));
            vec3 diffuse = uDiffuse * uLightDiffuse * lambert; // diffuse term
            
            // specular term (Blinn-Phong)
            vec3 eye = normalize(uEyePosition - vWorldPos);
            vec3 halfVec = normalize(light + eye);
            float highlight = pow(max(0.0,dot(normal,halfVec)), uShininess);
            vec3 specular = uSpecular * uLightSpecular * highlight; // specular term
            
            // combine to lighting color
            vec3 Cf = ambient + diffuse + specular;
            Cf = clamp(Cf, 0.0, 1.0);

            // choose blend mode
            if (uBlendMode == 0) {
                // REPLACE: draw texture directly (unlit)
                gl_FragColor = vec4(Ct.rgb, Ct.a * uMaterialAlpha);
            } else {
                // MODULATE: lighting modulates texture
                vec3 rgb = Cf * Ct.rgb;
                float alpha = Ct.a * uMaterialAlpha;
                gl_FragColor = vec4(rgb, alpha);
            }
        }
    `;
    
    try {
        var fShader = gl.createShader(gl.FRAGMENT_SHADER); // create frag shader
        gl.shaderSource(fShader,fShaderCode); // attach code to shader
        gl.compileShader(fShader); // compile the code for gpu execution

        var vShader = gl.createShader(gl.VERTEX_SHADER); // create vertex shader
        gl.shaderSource(vShader,vShaderCode); // attach code to shader
        gl.compileShader(vShader); // compile the code for gpu execution
            
        if (!gl.getShaderParameter(fShader, gl.COMPILE_STATUS)) { // bad frag shader compile
            throw "error during fragment shader compile: " + gl.getShaderInfoLog(fShader);  
            gl.deleteShader(fShader);
        } else if (!gl.getShaderParameter(vShader, gl.COMPILE_STATUS)) { // bad vertex shader compile
            throw "error during vertex shader compile: " + gl.getShaderInfoLog(vShader);  
            gl.deleteShader(vShader);
        } else { // no compile errors
            var shaderProgram = gl.createProgram(); // create the single shader program
            gl.attachShader(shaderProgram, fShader); // put frag shader in program
            gl.attachShader(shaderProgram, vShader); // put vertex shader in program
            gl.linkProgram(shaderProgram); // link program into gl context

            if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) { // bad program link
                throw "error during shader program linking: " + gl.getProgramInfoLog(shaderProgram);
            } else { // no shader program link errors
                gl.useProgram(shaderProgram); // activate shader program (frag and vert)
                
                // locate and enable vertex attributes
                vPosAttribLoc = gl.getAttribLocation(shaderProgram, "aVertexPosition"); // ptr to vertex pos attrib
                gl.enableVertexAttribArray(vPosAttribLoc); // connect attrib to array
                vNormAttribLoc = gl.getAttribLocation(shaderProgram, "aVertexNormal"); // ptr to vertex normal attrib
                gl.enableVertexAttribArray(vNormAttribLoc); // connect attrib to array
                vTexAttribLoc = gl.getAttribLocation(shaderProgram, "aTexCoord");
                gl.enableVertexAttribArray(vTexAttribLoc);

                // locate vertex uniforms
                mMatrixULoc = gl.getUniformLocation(shaderProgram, "umMatrix"); // ptr to mmat
                pvmMatrixULoc = gl.getUniformLocation(shaderProgram, "upvmMatrix"); // ptr to pvmmat
                
                // locate fragment uniforms
                eyePositionULoc = gl.getUniformLocation(shaderProgram, "uEyePosition"); // ptr to eye position
                var lightAmbientULoc = gl.getUniformLocation(shaderProgram, "uLightAmbient"); // ptr to light ambient
                var lightDiffuseULoc = gl.getUniformLocation(shaderProgram, "uLightDiffuse"); // ptr to light diffuse
                var lightSpecularULoc = gl.getUniformLocation(shaderProgram, "uLightSpecular"); // ptr to light specular
                var lightPositionULoc = gl.getUniformLocation(shaderProgram, "uLightPosition"); // ptr to light position
                ambientULoc = gl.getUniformLocation(shaderProgram, "uAmbient"); // ptr to ambient
                diffuseULoc = gl.getUniformLocation(shaderProgram, "uDiffuse"); // ptr to diffuse
                specularULoc = gl.getUniformLocation(shaderProgram, "uSpecular"); // ptr to specular
                shininessULoc = gl.getUniformLocation(shaderProgram, "uShininess"); // ptr to shininess
                materialAlphaULoc = gl.getUniformLocation(shaderProgram, "uMaterialAlpha"); // ptr to alpha
                blendModeULoc = gl.getUniformLocation(shaderProgram, "uBlendMode"); // ptr to blend mode
                textureULoc = gl.getUniformLocation(shaderProgram, "uTexture"); // ptr to sampler2D

                // pass global constants into fragment uniforms (initial)
                gl.uniform3fv(eyePositionULoc, Eye); // pass in the eye's position
                gl.uniform3fv(lightAmbientULoc, lightAmbient); // pass in the light's ambient emission
                gl.uniform3fv(lightDiffuseULoc, lightDiffuse); // pass in the light's diffuse emission
                gl.uniform3fv(lightSpecularULoc, lightSpecular); // pass in the light's specular emission
                gl.uniform3fv(lightPositionULoc, lightPosition); // pass in the light's position

                // default blend mode
                gl.uniform1i(blendModeULoc, blendMode);
                // default material alpha
                gl.uniform1f(materialAlphaULoc, 1.0);

                // bind texture unit 0 to sampler uniform
                gl.uniform1i(textureULoc, 0);
            } // end if no shader program link errors
        } // end if no compile errors
    } // end try 
    
    catch(e) {
        console.log(e);
    } // end catch
} // end setup shaders

// render the loaded model
function renderModels() {
    
    // construct the model transform matrix, based on model state
    function makeModelTransform(currModel) {
        var zAxis = vec3.create(), sumRotation = mat4.create(), temp = mat4.create(), negCtr = vec3.create();

        // move the model to the origin
        mat4.fromTranslation(mMatrix,vec3.negate(negCtr,currModel.center)); 
        
        // scale for highlighting if needed
        if (currModel.on)
            mat4.multiply(mMatrix,mat4.fromScaling(temp,vec3.fromValues(1.2,1.2,1.2)),mMatrix); // S(1.2) * T(-ctr)
        
        // rotate the model to current interactive orientation
        vec3.normalize(zAxis,vec3.cross(zAxis,currModel.xAxis,currModel.yAxis)); // get the new model z axis
        mat4.set(sumRotation, // get the composite rotation
            currModel.xAxis[0], currModel.yAxis[0], zAxis[0], 0,
            currModel.xAxis[1], currModel.yAxis[1], zAxis[1], 0,
            currModel.xAxis[2], currModel.yAxis[2], zAxis[2], 0,
            0, 0,  0, 1);
        mat4.multiply(mMatrix,sumRotation,mMatrix); // R(ax) * S(1.2) * T(-ctr)
        
        // translate back to model center
        mat4.multiply(mMatrix,mat4.fromTranslation(temp,currModel.center),mMatrix); // T(ctr) * R(ax) * S(1.2) * T(-ctr)

        // translate model to current interactive orientation
        mat4.multiply(mMatrix,mat4.fromTranslation(temp,currModel.translation),mMatrix); // T(pos)*T(ctr)*R(ax)*S(1.2)*T(-ctr)
        
    } // end make model transform
    
    // matrices
    var pMatrix = mat4.create(); // projection matrix
    var vMatrix = mat4.create(); // view matrix
    var mMatrix = mat4.create(); // model matrix
    var pvMatrix = mat4.create(); // proj * view matrices
    var pvmMatrix = mat4.create(); // proj * view * model matrices
    
    window.requestAnimationFrame(renderModels); // set up frame render callback
    
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); // clear frame/depth buffers
    
    // set up projection and view
    mat4.perspective(pMatrix,0.5*Math.PI,1,0.1,10); // create projection matrix
    mat4.lookAt(vMatrix,Eye,Center,Up); // create view matrix
    mat4.multiply(pvMatrix,pvMatrix,pMatrix); // projection
    mat4.multiply(pvMatrix,pvMatrix,vMatrix); // projection * view

    // update eye uniform in shader (eye can move)
    if (eyePositionULoc) gl.uniform3fv(eyePositionULoc, Eye);
    // update blend mode uniform every frame
    if (blendModeULoc) gl.uniform1i(blendModeULoc, blendMode);

    // prepare two lists: opaque sets and transparent sets
    var opaqueSets = [];
    var transparentSets = [];

    for (var i=0; i<numTriangleSets; i++) {
        // determine transparency: check transparentMask or curr material.alpha
        var curr = inputTriangles[i];
        var materialAlpha = 1.0;
        if (curr.material && typeof curr.material.alpha === "number") materialAlpha = curr.material.alpha;
        var isTransparent = transparentMask[i] || (materialAlpha < 1.0);
        if (isTransparent) transparentSets.push(i); else opaqueSets.push(i);
    }

    // First draw opaque sets (depth writes on)
    gl.depthMask(true);
    drawSets(opaqueSets, pvMatrix);

    // Then draw transparent sets sorted back-to-front
    if (transparentSets.length > 0) {
        // compute centroid distances (approx) and sort descending
        var sortList = transparentSets.map(function(i) {
            // compute world-space center for approximate distance
            var center = vec3.clone(inputTriangles[i].center);
            // include translation
            if (inputTriangles[i].translation) vec3.add(center, center, inputTriangles[i].translation);
            var d = vec3.squaredDistance(Eye, center);
            return {idx: i, dist: d};
        });
        sortList.sort(function(a,b){ return b.dist - a.dist; }); // back-to-front

        var sorted = sortList.map(function(x){ return x.idx; });

        // disable depth writes so transparent fragments don't prevent underlying draws
        gl.depthMask(false);
        drawSets(sorted, pvMatrix);
        // restore depth write
        gl.depthMask(true);
    }
} // end renderModels

// helper: draw array of triangle set indices using current shader and state
function drawSets(setIndexArray, pvMatrix) {
    var mMatrix = mat4.create();
    var pvmMatrix = mat4.create();
    for (var s=0; s<setIndexArray.length; s++) {
        var whichTriSet = setIndexArray[s];
        var currSet = inputTriangles[whichTriSet];

        // make model transform, add to view project
        makeModelTransformLocal(currSet, mMatrix); // local helper below
        mat4.multiply(pvmMatrix, pvMatrix, mMatrix); // project * view * model

        // pass matrices
        gl.uniformMatrix4fv(mMatrixULoc, false, mMatrix);
        gl.uniformMatrix4fv(pvmMatrixULoc, false, pvmMatrix);

        // reflectivity: feed to the fragment shader (use defaults if missing)
        var amb = currSet.material && currSet.material.ambient ? currSet.material.ambient : [0.2,0.2,0.2];
        var dif = currSet.material && currSet.material.diffuse ? currSet.material.diffuse : [0.8,0.8,0.8];
        var spec = currSet.material && currSet.material.specular ? currSet.material.specular : [0.2,0.2,0.2];
        var n = currSet.material && currSet.material.n ? currSet.material.n : 10.0;
        var matAlpha = currSet.material && currSet.material.alpha ? currSet.material.alpha : 1.0;

        gl.uniform3fv(ambientULoc, amb);
        gl.uniform3fv(diffuseULoc, dif);
        gl.uniform3fv(specularULoc, spec);
        gl.uniform1f(shininessULoc, n);
        gl.uniform1f(materialAlphaULoc, matAlpha);

        // vertex buffer: activate and feed into vertex shader
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffers[whichTriSet]);
        gl.vertexAttribPointer(vPosAttribLoc, 3, gl.FLOAT, false, 0, 0);

        // normal buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffers[whichTriSet]);
        gl.vertexAttribPointer(vNormAttribLoc, 3, gl.FLOAT, false, 0, 0);

        // texcoord buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffers[whichTriSet]);
        gl.vertexAttribPointer(vTexAttribLoc, 2, gl.FLOAT, false, 0, 0);

        // bind texture unit 0
        var tex = textureObjects[whichTriSet];
        if (tex) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tex);
        } else {
            // ensure something bound
            gl.bindTexture(gl.TEXTURE_2D, null);
        }

        // triangle buffer: activate and render
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triangleBuffers[whichTriSet]);
        gl.drawElements(gl.TRIANGLES, 3 * triSetSizes[whichTriSet], gl.UNSIGNED_SHORT, 0);
    }

    // local helper used above: compute model transform
    function makeModelTransformLocal(currModel, outM) {
        var zAxis = vec3.create(), sumRotation = mat4.create(), temp = mat4.create(), negCtr = vec3.create();

        // move the model to the origin
        mat4.fromTranslation(outM, vec3.negate(negCtr, currModel.center));

        // scale for highlighting if needed
        if (currModel.on)
            mat4.multiply(outM, mat4.fromScaling(temp, vec3.fromValues(1.2,1.2,1.2)), outM); // S(1.2) * T(-ctr)

        // rotate the model to current interactive orientation
        vec3.normalize(zAxis, vec3.cross(zAxis, currModel.xAxis, currModel.yAxis)); // get the new model z axis
        mat4.set(sumRotation, // get the composite rotation
            currModel.xAxis[0], currModel.yAxis[0], zAxis[0], 0,
            currModel.xAxis[1], currModel.yAxis[1], zAxis[1], 0,
            currModel.xAxis[2], currModel.yAxis[2], zAxis[2], 0,
            0, 0,  0, 1);
        mat4.multiply(outM, sumRotation, outM); // R(ax) * S(1.2) * T(-ctr)

        // translate back to model center
        mat4.multiply(outM, mat4.fromTranslation(temp, currModel.center), outM); // T(ctr) * R(ax) * S(1.2) * T(-ctr)

        // translate model to current interactive orientation
        if (!currModel.translation) currModel.translation = vec3.fromValues(0,0,0);
        mat4.multiply(outM, mat4.fromTranslation(temp, currModel.translation), outM); // T(pos)*T(ctr)*R(ax)*S(1.2)*T(-ctr)
    }
} // end drawSets

// setup key handling for blend toggle
function setupKeys() {
  window.addEventListener("keydown", function (e) {
    if (e.key === "b" || e.key === "B") {
      blendMode = 1 - blendMode;
      // we update the uniform every frame; immediate update too:
      if (blendModeULoc) gl.uniform1i(blendModeULoc, blendMode);
      console.log("Blend mode toggled. Now: " + (blendMode === 0 ? "REPLACE (texture only)" : "MODULATE (lighting * texture)"));
    }
  });
}

/* MAIN -- HERE is where execution begins after window load */

function main() {
  setupWebGL(); // set up the webGL environment
  loadModels(); // load in the models from tri file
  setupShaders(); // setup the webGL shaders
  setupKeys();
  renderModels(); // draw the triangles using webGL
} // end main

// call main after load
window.onload = main;
