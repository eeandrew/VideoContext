import VideoNode from "./SourceNodes/videonode.js";
import ProcessingNode from "./ProcessingNodes/processingnode.js";
import DestinationNode from "./DestinationNode/destinationnode.js";
import EffectNode from "./ProcessingNodes/effectnode.js";
import RenderGraph from "./rendergraph.js";

let updateables = [];
let previousTime;
function registerUpdateable(updateable){
    updateables.push(updateable);
}
function update(time){
    if (previousTime === undefined) previousTime = time;
    let dt = (time - previousTime)/1000;
    for(let i = 0; i < updateables.length; i++){
        updateables[i]._update(dt);
    }
    previousTime = time;
    requestAnimationFrame(update);
}
update();


let STATE = {"playing":0, "paused":1, "stalled":2, "ended":3, "broken":4};
//playing - all sources are active
//paused - all sources are paused
//stalled - one or more sources is unable to play
//ended - all sources have finished playing
//broken - the render graph is in a broken state


class VideoContext{
    constructor(canvas){
        this._gl = canvas.getContext("webgl");
        this._renderGraph = new RenderGraph();
        this._sourceNodes = [];
        this._processingNodes = [];
        this._timeline = [];
        this._currentTime = 0;
        this._state = STATE.paused;
        this._destinationNode = new DestinationNode(this._gl, this._renderGraph);
        registerUpdateable(this);
        let lutImage = new Image();

        let test = new ProcessingNode(this._gl, this._renderGraph, {
            "fragmentShader":"\
                precision mediump float;\
                uniform sampler2D u_image;\
                uniform float a;\
                uniform float b;\
                uniform vec4 c;\
                varying vec2 v_texCoord;\
                varying float v_progress;\
                void main(){\
                    vec4 color = texture2D(u_image, v_texCoord);\
                    color[0] += a;\
                    color+= c;\
                    gl_FragColor = color;\
                }", 
            "vertexShader":"\
                attribute vec2 a_position;\
                attribute vec2 a_texCoord;\
                varying vec2 v_texCoord;\
                void main() {\
                    gl_Position = vec4(vec2(2.0,2.0)*a_position-vec2(1.0, 1.0), 0.0, 1.0);\
                    v_texCoord = a_texCoord;\
                }",
            "properties":{
                "a":{value:1, type:"uniform"},
                "b":{value:2, type:"uniform"},
                "c":{value:[0.1,0.2,0.4,0.0], type:"uniform"},
                "lut":{value:lutImage, target:"fragment", type:"uniform"}
            },
            "inputs":["u_image"]
        });
    }

    set currentTime(currentTime){
        console.debug("VideoContext - seeking to", currentTime);

        if (typeof currentTime === 'string' || currentTime instanceof String){
            currentTime = parseFloat(currentTime);
        }

        for (let i = 0; i < this._sourceNodes.length; i++) {
            this._sourceNodes[i]._seek(currentTime);
        }
        this._currentTime = currentTime;
    }

    /**
    * Get how far through the internal timeline has been played.
    *
    * Getting this value will give the current playhead position. Can be used for updating timelines.
    * @return {number} The time in seconds through the current playlist.
    * 
    * @example
    * var ctx = new VideoContext();
    * var canvasElement = document.getElemenyById("canvas");
    * var videoNode = ctx.createVideoSourceNode("video.mp4");
    * var outputNode =ctx.createOutputNode(cavnasElement);
    * videoNode.connect(outputNode);
    * videoNode.start();
    * videoCtx.play();
    *
    */
    get currentTime(){
        return this._currentTime;
    }

    get duration(){
        let maxTime = 0;
        for (let i = 0; i < this._sourceNodes.length; i++) {
            if (this._sourceNodes[i]._stopTime > maxTime){
                maxTime = this._sourceNodes[i]._stopTime;
            }
        }
        return maxTime;
    }

    get destination(){
        return this._destinationNode;
    }

    play(){
        console.debug("VideoContext - playing");
        for (let i = 0; i < this._sourceNodes.length; i++) {
            this._sourceNodes[i]._play();
        }
        this._state = STATE.playing;
        return true;
    }

    pause(){
        console.debug("VideoContext - pausing");
        for (let i = 0; i < this._sourceNodes.length; i++) {
            this._sourceNodes[i]._pause();
        }
        this._state = STATE.paused;
        return true;
    }

    createVideoSourceNode(src, sourceOffset=0){
        let videoNode = new VideoNode(src, this._gl,this._renderGraph, sourceOffset);
        this._sourceNodes.push(videoNode);
        return videoNode;
    }

    createEffectNode(definition){
        let effectNode = new EffectNode(this._gl, this._renderGraph, definition);
        this._processingNodes.push(effectNode);
        return effectNode;
    }

    _isStalled(){
        for (let i = 0; i < this._sourceNodes.length; i++) {
            let sourceNode = this._sourceNodes[i];
            if (!sourceNode._isReady()){
                return true;
            }
        }
        return false;
    }

    _update(dt){

        if (this._state === STATE.playing || this._state === STATE.stalled || this._state === STATE.paused) {
            
            if (this._state !== STATE.paused){
                if (this._isStalled()){
                    this._state = STATE.stalled;
                }else{
                    this._state = STATE.playing;
                }    
            }
            

            if(this._state === STATE.playing){
                    this._currentTime += dt;
                    if(this._currentTime > this.duration)this._state = STATE.ended;
            }


            for (let i = 0; i < this._sourceNodes.length; i++) {
                let sourceNode = this._sourceNodes[i];
                sourceNode._update(this._currentTime);

                if(this._state === STATE.stalled){
                    if (sourceNode._isReady()) sourceNode._pause();
                }
                if(this._state === STATE.paused){
                    sourceNode._pause();
                }
                if(this._state === STATE.playing){
                    sourceNode._play();
                }
            }

            this._destinationNode._render();
            for (let node of this._processingNodes) {
                node._render();
            }
        }
    }
}

export default VideoContext;