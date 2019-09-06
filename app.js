var rp = require('request-promise-native');
var fs = require('fs-promise');
var ffmpeg = require('fluent-ffmpeg');
var moment = require('moment');
var striptags = require('striptags');
var cp = require('child_process');
var data = "gones.json";


var gones = [];
/* ffmpeg.getAvailableFormats(function (err, codecs) {
    console.log('Available codecs:');
    console.dir(codecs);
});*/

var Gone = function (object) {
    for (let thing in object) {
        this[thing] = object[thing];
    }
    this.transcript = striptags(this.snip);
    if (this.transcript.includes("gone are the days") || this.transcript.includes("gone were the days")) {
        console.log(this.identifier, "found phrase");
        this.found = true;

    }
    this.start = parseInt(this.start, 10);
    this.finds = [];
};

Gone.prototype.fetchVideo = async function () {
    if (fs.existsSync(this.identifier + ".mp4")){
	return Promise.resolve();
    }
    var start = this.start - 20;
    if (start < 0) {
        start = 0;
    }
    console.log(start);
    var end = start + 60;
    var url = "http://archive.org/download/" + this.identifier + "/" + this.identifier + ".mp4?t=" + start + "/" + end + "&ignore=x.mp4";
    console.log("fetching: ", url);

    var asdf = await getFile(url, "media/" + this.identifier + ".mp4");
    this.localFile = asdf;

};

Gone.prototype.tcodeOpus = async function () {
    var gon = this;
    console.log("transcoding audio");
    var path = this.localFile.replace(".mp4", ".opus");
    console.log(path);

    return new Promise(async function (resolve) {
        if (await fs.exists(path)) {
            console.log("file exists");
            gon.localOpus = path;
            resolve();
        }
        ffmpeg(gon.localFile).audioCodec('libopus').on('end', function () {
            gon.localOpus = path;
            resolve();
        }).output(path).run();

    });
}



Gone.prototype.tcodeNorm = async function () {
    var gon = this;
    console.log("transcoding normalized video");
    var path = this.localFile.replace(".mp4", "_normalized.mp4");

    return new Promise(async function (resolve) {
        if (await fs.exists(path)) {
            console.log("file exists");
            gon.localNormalized = path;
            resolve();
        }
        //ffmpeg -i input.wav -filter:a loudnorm output.wav
        var encode = cp.exec('ffmpeg -y -analyzeduration 999999999 -probesize 999999999 -i ' + gon.localFile + ' -filter:a loudnorm -vcodec copy ' + path, { timeout: 50000 }, (error, stdout, stderr) => {
            if (error) {
                console.error(`exec error: ${error}`);
                return;
            }
            console.log(`stdout: ${stdout}`);
            console.log(`stderr: ${stderr}`);
            gon.localPCM = path;
            resolve();
        });
    });

}

Gone.prototype.tcodeWav = async function () {
    var gon = this;
    console.log("transcoding wav");
    var path = this.localFile.replace(".mp4", ".wav");

    return new Promise(async function (resolve) {
        if (await fs.exists(path)) {
            console.log("file exists");
            gon.localPCM = path;
            resolve();
        }
        var encode = cp.exec('ffmpeg -i ' + gon.localFile + ' -acodec pcm_s16le -ac 1 -ar 16000 ' + path, (error, stdout, stderr) => {
            if (error) {
                console.error(`exec error: ${error}`);
                return;
            }
            console.log(`stdout: ${stdout}`);
            console.log(`stderr: ${stderr}`);
            gon.localPCM = path;
            resolve();
        });
    });

}

Gone.prototype.speech2text = async function () {
    var gon = this;
    var path = this.localFile.replace(".mp4", ".txt");
    if (fs.existsSync(path) && fs.statSync(path).size){
	console.log("already sphinx'd");
	var sp = fs.readFileSync(path, "utf8");
	console.log(sp);
	gon.processSpeech(sp);
	return Promise.resolve();
    }
    return new Promise(async function (resolve) {
	var command = 'pocketsphinx_continuous -infile ' + gon.localPCM + ' -kws_threshold /1e-40/ -time yes -logfn /dev/null -keyphrase "' + gon.phrase + '"';
	console.log(command);
        var listen = cp.exec(command, async (error, stdout, stderr) => {
            if (error) {
                console.error(`exec error: ${error}`);
                throw(error);
            }
            var results = gon.processSpeech(stdout);
            console.log(`stderr: ${stderr}`);
            await fs.writeFile(path, stdout);
            resolve();
        });
    });

}

Gone.prototype.processSpeech = async function (inc) {
    console.log("processing speech");
    //console.log(inc);
    var finds = [];
    inc = inc.split(/\n/);
    var repl = new RegExp(this.phrase, "gi");

    console.log(inc.length, "incs");
    for (let i of inc) {
        console.log(i);
        i = i.replace(repl, "").trim();
        console.log(i);
        if (i.length > 5 && !i.includes("!!!")) {
            console.log("processing a find");
            console.log(i);
            i = i.split(" ");
            let find = {
                start: i[0],
                end: i[1],
                confidence: i[2]
            };
            console.log(find);
            finds.push(find);
        }
    }
    this.finds = finds;
    console.log(this);


};

var getGones = async function () {

    var queries = [{
        phrase: "gone are the days"
    }, {
        phrase: "gone were the days"
    }];
    for (let q of queries) {
        let queryphrase = q.phrase.replace(/\s/g, "%20");
        q.url = "http://archive.org/details/tv?q=%22" + queryphrase + "%22&output=json";
    }
    /* old var queries = ["http://archive.org/details/tv?q=%22gone%20are%20the%20days%22&output=json", "http://archive.org/details/tv?q=%22gone%20were%20the%20days%22&output=json"]; */

    console.log("cmon");
    for (let q of queries) {
        console.log("trying ", q.phrase);
        let json = await jsonz(q.url);
        for (let clip of json) {
            clip.phrase = q.phrase;
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
var jsonz = async function (url) {
    console.log("getting jsons");
    var done = false;
    var counter = 1;
    var results = [];
    console.log("page ", counter);
    while (!done) {
        let res = await getJSON((url + "&page=" + counter));
        if (!res.length) {
            done = true;
            console.log("done");
            return results;
        }
        results = results.concat(res);
        counter++;
        console.log(results.length)
    }
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
    return nGones.sort(compareDates).reverse();
};

var compareDates = function(a,b){
   let aDate = string2date(a.title);
   let bDate = string2date(b.title);
   console.log(aDate, bDate);
   if (aDate > bDate) {
     console.log("a");
     return -1;
   } else {
     console.log("b");
     return 1;
   }
 
 
};

var string2date = function(str){
 
   var datestring = str.split(" : ");
   datestring = datestring[datestring.length - 1];
   datestring = datestring.split("-");
    datestring = datestring[0] + datestring[1].split(" ")[1];

    var test = moment(datestring, "MMMM Do, YYYY hh:mmA z").format("X");
    return test;

};

var go = async function () {
    //var gones = await getGones();
    //gones = processGones(gones);
    //await fs.writeFile("processed.json", JSON.stringify(gones, undefined, 2));
    var gones = JSON.parse(fs.readFileSync("processed.json"));
    gones = processGones(gones);
    for (let gone of gones) {
        //console.log(gone);
        await gone.fetchVideo();
        await gone.tcodeOpus();
        await gone.tcodeWav();
        await gone.tcodeNorm();
        await gone.speech2text();
        await fs.writeFile("data.json", JSON.stringify(gones, undefined, 2));

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
