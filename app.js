var rp = require('request-promise-native');
var fs = require('fs-promise');
var ffmpeg = require('fluent-ffmpeg');
var moment = require('moment');
var dmp = require('diff-match-patch-node');
const lcs = require('longest-common-subsequence');
var striptags = require('striptags');
var cp = require('child_process');
var data = "gones.json";
var mediaDir = "/media/maldarchive/gonegonegone/media/";
var stringSimilarity = require("string-similarity");

const smtihWaltermanScore = require('smith-walterman-score');
const options = { gap: -1, mismatch: -2, match: 2 };

var gones = [];
var dict = [""];
/* ffmpeg.getAvailableFormats(function (err, codecs) {
    console.log('Available codecs:');
    console.dir(codecs);
});*/

var nots = [];

var Gone = function (object) {
    console.log("instantiating gone");
    for (let thing in object) {
        this[thing] = object[thing];
    }
    this.start = parseInt(this.start, 10);
    this.finds = [];
};

Gone.prototype.fetchVideo = async function () {
    if (fs.existsSync(this.identifier + ".mp4")) {
        return Promise.resolve();
    }
    var start = this.start - 20;
    if (this.truncated) {
        start = this.start - 35;
    }

    if (start < 0) {
        start = 0;
    }
    console.log(start);
    var end = start + 60;
    var url = "http://archive.org/download/" + this.identifier + "/" + this.identifier + ".mp4?t=" + start + "/" + end + "&ignore=x.mp4";
    console.log("fetching: ", url);

    var asdf = await getFile(url, mediaDir + this.identifier + ".mp4");
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
        try {
            ffmpeg(gon.localFile).audioCodec('libopus').audioBitrate("32k").on('start', function (cmd) {
                console.log("invoked with", cmd);
            }).on('end', function () {
                gon.localOpus = path;
                resolve();
            }).output(path).run();
        } catch (e) {
            throw (e);
        }
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
        //ffmpeg -i this.localPCM -filter:a loudnorm output.wav
        var encode = cp.exec('ffmpeg -y -analyzeduration 999999999 -probesize 999999999 -i ' + gon.localFile + ' -filter:a loudnorm -max_muxing_queue_size 9999 -vcodec copy ' + path, { timeout: 50000 }, (error, stdout, stderr) => {
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
    if (fs.existsSync(path) && fs.statSync(path).size) {
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
                throw (error);
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

var findGone = async function (phrase) {
    for (let i = 0; i < gones.length; i++) {
        if (gones[i].transcript === phrase) {
            return i;
        }
    }
}

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

var processGones = async function (gones) {
    dict = [""];


    var nGones = [];
    let thisGone = 0;
    for (let gone of gones) {

        gone.transcript = striptags(gone.snip);
        if (gone.transcript.includes("gone are the day") || gone.transcript.includes("gone were the day")) {
            console.log(gone.identifier, "found phrase");
            gone.found = true;
        } else if (gone.transcript.includes("are the day") || gone.transcript.includes("were the day")) {
            gone.truncated = true;
            gone.found = true;
        }
        let isMatched = await matched(gone);
        if (!isMatched) {
            console.log("adding gone");
            nGones.push(new Gone(gone));
            dict.push(gone.transcript);
        } else {
            console.log("naw");
        }
        console.log(thisGone, "/", gones.length, "(", nGones.length, ")")
        thisGone++;
    }
    return nGones.sort(compareDates); //.reverse();
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
};

var matched = async function (gone) {

    let gonewords = gone.transcript;
    let dic = [...dict];
    var index = dic.indexOf(gonewords);
    if (index !== -1) {
        dic.splice(index, 1);
    }
    let ss = stringSimilarity.findBestMatch(gonewords, dic);
    let best = ss.ratings[ss.bestMatchIndex];
    console.log('\x1b[36m%s\x1b[0m', best.rating);
    await sleep(1000);
    console.log("testing: ", gone.transcript), "\n";

    console.log("vs :", ss.ratings[ss.bestMatchIndex],"\n");
    if (best.rating > 0.85) {
        console.log("match")
        console.log(gonewords);
        console.log(ss.ratings[ss.bestMatchIndex]);
        return true;
    } else if (best.rating > 0.6) {
        for (let d of dic) {
            let a = gone.transcript.substr(0,100);
            let b = d.substr(0,100);
            let elcs = lcs(a,b);
            console.log(elcs.length);
            let long = Math.max(a.length, b.length);
            if (elcs.length > long * 0.65) {
                console.log("match", elcs.length);
                console.log(gone.transcript, "\n");
                console.log(d);
                console.log(">>>>>>>>>elcs: \n", elcs);
                await sleep(2500);
                return true;
            } else {
                console.log("no match yet...");
            }
        }
        console.log("...no match");
        return false;
    } else {
        return false;
    }
    return best.rating;
    /*
    } else {
        if (best.rating > 0.6) {
            console.log("no match")
            console.log(gonewords);
            console.log(ss.ratings[ss.bestMatchIndex]);
        }
        return false;
    }
    /*
    for (let gon of gones) {
        if (gon.identifier === gone.identifier) {
       
        } else {
            let gonewords = striptags(gone.snip);
            let gonwords = striptags(gon.snip);
            
            let dist = stringSimilarity.compareTwoStrings(gonewords,gonwords);
            //console.log(gone.snip);
            console.log(dist);
            if (dist.length > 0.5) {
                console.log("matched existing");
                console.log(gonewords.substr(0, 200), gonwords.substr(0, 200));
                process.exit();
                return true;
            } else {
                return false;
                //console.log("new phrase:", gonwords);
            }
        }
    }
    */

}

var compareDates = function (a, b) {
    let aDate = string2date(a.title);
    let bDate = string2date(b.title);
    //console.log(aDate, bDate);
    if (aDate > bDate) {
        //console.log("a");
        return -1;
    } else {
        //console.log("b");
        return 1;
    }


};

var string2date = function (str) {

    var datestring = str.split(" : ");
    datestring = datestring[datestring.length - 1];
    datestring = datestring.split("-");
    datestring = datestring[0] + datestring[1].split(" ")[1];

    var test = moment(datestring, "MMMM Do, YYYY hh:mmA z").format("X");
    return test;

};

var go = async function () {
    //var gones = await getGones();
    let a = "long gone were the days where school was considered a safe haven. students were cold it was an isolated incident, it would never happen again. yet here we are 25 years later. with massacres such as columbine, virginia tech and the newtown shooting. so you have to ask the question, what is the solution? john fund, a columnist, explains. >> we have those who want to focus on the guns, and other people want to focus on the criminally insane or the criminal minds behind these horrific incidents. >> what is the answer?".split('');
    let b = "long gone were the days where school was considered a safe haven. students were cold it was an isolated incident, it would never happen again. yet here we are 25 years later. with massacres such as columbine, virginia tech and the newtown shooting. so you have to ask".split('');
    let c = "are the days when the nightly news was a national convening. it will not sit around anymore. the sunday shows, the relevance they used to have for driving the debate in the coming week, all but disappeared. and so, i think people are just experimenting still. when some daylight between two ferns, one of the single greatest communications moments of the white house. a president communicating with an audience he desperately needed to communicate with. it was important. it had national significance. i agree with you. it should not be done at these exclusion of the hard interview. marty: olivier mentioned the speech obama made at the toner prize, which is a price for politics journalism, let me read you what he said. the job has gotten tougher, even as the appetite for information and data flowing into the internet is voracious, the news cycle has shrunk. too often there is enormous pressure to fill the void and feed the beast with instant commentary and celebrity gossip and softer stories. and we fail to understand our world, and one another, as".split('');

    let gones = JSON.parse(fs.readFileSync("data.json"));
    console.log("processing...")
    gones = await processGones(gones);
    console.log("writing files")
    fs.writeFileSync("processed.json", JSON.stringify(gones, undefined, 2));
    /*
    console.log("checking local file");
    gones = JSON.parse(fs.readFileSync("processed.json"));
    console.log(gones.length);
    gones = processGones(gones);
    */
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
