var rp = require('request-promise-native');
var fs = require('fs-promise');
var striptags = require('striptags');

var queries = ["http://archive.org/details/tv?q=%22gone%20are%20the%20days%22&output=json", "http://archive.org/details/tv?q=%22gone%20were%20the%20days%22&output=json"];
var data = "gones.json";

var Gone = function (object) {
    for (let thing in object) {
        this[thing] = object[thing];
    }
    this.transcript = striptags(this.snip);
    if (this.transcript.includes("gone are the days") || this.transcript.includes("gone were the days")) {
        console.log(this.identifier, "found phrase");
        this.found = true;

    }
};

Gone.prototype.fetchVideo = async function () {
    var start = this.start;
    if (this.start > 10) {
        start = start - 10;
    }
    var end = start + 60;
    var url = "http://archive.org/download" + this.identifier + "/" + this.identifier + ".mp4?t=" + start + "/" + end + "&ignore=x.mp4"
    var asdf = await getFile(this.video, "videos/" + this.identifier + ".mp4");
    this.localFile = asdf;

};

var getGones = async function (queries) {
    var gones = [];
    console.log("cmon");
    for (let q of queries) {
        console.log(q);
        console.log("trying ", q);
        let json = await getJSON(q);
        for (let clip of json) {
            gones.push(clip);
        }
        console.log(json.length);
    }
    await fs.writeFile('data.json', JSON.stringify(gones, undefined, 2));
    return gones;
}

var getJSON = function (url) {
    console.log('requesting ', url);
    return new Promise(function (resolve) {
        rp(url, {
            method: 'get'
        }).then(function (response) {
            console.log("got response", response.length);
            resolve(JSON.parse(response));

        }).catch(function (err) {
            console.log(err);
        });

    });

}

var getFile = function (url, dest) {
    console.log('trying ', url);
    return new Promise(async function (resolve) {
        if (await fs.exists(dest)) {
            console.log("file exists");
            resolve(dest);
        } else {
            rp(url, {
                method: 'get',
                encoding: null
            }).then(async function (response) {
                await fs.writeFile(dest, response);
                console.log("file written: ", dest);
                resolve(dest);
            }).catch(function (err) {
                console.log(err);
            });
        }
    });

}

var processGones = function (gones) {
    var nGones = [];
    for (let gone of gones) {
        nGones.push(new Gone(gone))
    }
    return nGones;
};

var go = async function () {
    var gones = await getGones(queries);
    gones = processGones(gones);
    await fs.writeFile("processed.json", JSON.stringify(gones, undefined, 2));
    for (let gone of gones) {
        //console.log(gone);
        await gone.fetchVideo();
        await gone.tcodeAudio();
    }
    var found = [];
    for (let gone of gones) {
        if (gone.found) {
            found.push(gone);
        }
    }
    await fs.writeFile("found.json", JSON.stringify(gones, undefined, 2));
};

go();

/*
ffmpeg -i INPUT -acodec pcm_s16le -ac 1 -ar 16000 OUTPUT

pocketsphinx_continuous -infile WAV -keyphrase "gone are the days" -kws_threshold /1e-40/ -time yes
*/