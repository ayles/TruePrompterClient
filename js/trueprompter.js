let TTruePrompterRequest = null;
let TTruePrompterResponse = null;

class TTruePrompterClient {
    constructor() {
        this.setWords([]);
        this.internalConnect();
        this.onPositionChange = (words, position) => {};
        this.lookAhead = null;
    }

    setWords(words, position) {
        this.words = words;
        this.position = position || { wordIndex: 0, wordFraction: 0.0 };
        this.internalPushText();
    }

    setLookAhead(lookAhead) {
        this.lookAhead = lookAhead;
        this.internalPushLookAhead();
    }

    acceptWaveform(floatBuffer, sampleRate) {
        let request = TTruePrompterRequest.create();
        request.audio = floatBuffer;
        request.sampleRate = sampleRate;
        this.internalSend(request);
    }

    getPosition() {
        return this.position;
    }

    internalConnect() {
        if (this.ws === undefined || (this.ws && this.ws.readyState === WebSocket.CLOSED)) {
            let protocol = "ws://";
            let ending = ":8080";
            if (location.protocol === 'https:') {
                protocol = "wss://";
                ending = ":443/wsapp";
            }
            this.ws = new WebSocket(protocol + location.hostname + ending);
            this.ws.binaryType = "arraybuffer";
            this.ws.onopen = ev => {
                this.internalPushText();
                this.internalPushLookAhead();
            };
            this.ws.onclose = ev => {
                setTimeout(() => { this.internalConnect(); }, 1000);
            };
            this.ws.onerror = ev => {
                console.error(ev);
            };
            this.ws.onmessage = ev => {
                this.internalUpdatePosition(ev.data);
            };
        }
    }

    internalUpdatePosition(buffer) {
        let response = TTruePrompterResponse.decode(new Uint8Array(buffer));
        this.position = response.position;
        this.onPositionChange(this.words, this.position);
    }

    internalSend(request) {
        console.log(request);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(TTruePrompterRequest.encode(request).finish());
        }
    }

    internalPushText() {
        let request = TTruePrompterRequest.create();
        request.position = this.position;
        request.words = this.words;
        this.internalSend(request);
    }

    internalPushLookAhead() {
        if (this.lookAhead == null) {
            return;
        }
        let request = TTruePrompterRequest.create();
        request.lookAhead = this.lookAhead;
        this.internalSend(request);
    }
}

class TTruePrompterMicRecorder {
    constructor() {
        this.onWaveform = (floatBuffer, sampleRate) => {};
        this.recording = false;
    }

    start() {
        this.recording = true;

        if (!this.recorder) {
            if (navigator.mediaDevices) {
                this.audioCtx = new AudioContext();
                navigator.mediaDevices.getUserMedia({ "audio": true }).then((stream) => {
                    let input = this.audioCtx.createMediaStreamSource(stream);
                    this.recorder = new Recorder(input, {
                        numChannels: 1
                    });
                    if (this.recording) {
                        this.recorder.record();
                    }
                    this.interval = setInterval(() => {
                        if (this.recording) {
                            this.recorder.getBuffer(buf => {
                                this.onWaveform(buf[0], this.audioCtx.sampleRate);
                            });
                            this.recorder.clear();
                        }
                    }, 200);
                });
            }
        }

        if (this.recorder) {
            this.recorder.record();
        }
    }

    stop() {
        this.recording = false;
        if (this.recorder) {
            this.recorder.stop();
        }
    }
}

class TTruePrompterManager {
    constructor() {
        this.client = new TTruePrompterClient();
        this.micRecorder = new TTruePrompterMicRecorder();
        this.micRecorder.onWaveform = (floatBuffer, sampleRate) => {
            this.client.acceptWaveform(floatBuffer, sampleRate);
        };
        this.running = false;
    }

    start(words, position, callback) {
        this.client.setWords(words, position);
        this.client.onPositionChange = callback;
        this.micRecorder.onWaveform = this.client.acceptWaveform.bind(this.client);
        this.micRecorder.start();
        this.running = true;
    }

    stop() {
        this.running = false;
        this.micRecorder.stop();
        this.micRecorder.onWaveform = (floatBuffer, sampleRate) => {};
        this.client.onPositionChange = (words, position) => {};
    }

    setLookAhead(lookAhead) {
        if (this.running) {
            this.client.setLookAhead(lookAhead);
        }
    }
}

function initTruePrompter() {
    return protobuf.load("protocol.proto").then(root => {
        TTruePrompterRequest = root.lookupType("NTruePrompter.TRequest");
        TTruePrompterResponse = root.lookupType("NTruePrompter.TResponse");
    }).catch(err => console.error(err));
}
