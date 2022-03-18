'use strict';

let express = require('express');
let route = express.Router();
let mysql = require('mysql2');
let crypto = require('crypto');
let bodyParser = require('body-parser');
let axios = require('axios');
let promise = require('promise');
let jsonParser = bodyParser.json();
let urlEncodedForm = bodyParser.urlencoded({ extended: true });
let cloudinary = require('cloudinary').v2;
let streamifier = require('streamifier');
let multer = require('multer');
let DB_CONFIG = require('../config/db.config')
let CLOUD_CONFIG = require('../config/cloud.config');
let connect = mysql.createConnection(DB_CONFIG.EHRLICH_MYSQL_DB_CONFIG);
let pexels = require('pexels');
const { resolve } = require('promise');
let getPexels = pexels.createClient(CLOUD_CONFIG.PEXEL_CONFIG.API_KEY);
cloudinary.config(CLOUD_CONFIG.CLOUDINARY_CONFIG);

const addSingleFile = async (url) => {
    await cloudinary.uploader.upload(url, { folder: Ehrlich }, (err, result) => {
        if (err) throw err;
        return result;
    })
}

const destroyFile = async (public_id) => {

    await cloudinary.uploader.destroy(public_id, (err, result) => {
        if (err) throw err;
        return result;
    })
}


const verifyUser = (req, res, next) => {

    //VERIFY USER (WIP)

    req.USER_EMAIL = 'email@admin.com';
    req.USER_ROLE = 'administrator';

    next();

    /*let email = req.query.email;
    let verifyEmail = req.query.email.match(/^\S+@\S+\.\S+$/);
    let enc = crypto.createHash('sha256').update(req.query.password).digest('hex');   

    if (verifyEmail) {
        let sql = `SELECT * FROM tbl_users WHERE email = '${email}' AND password = '${enc}'`

        connect.query(sql, (err, result) => {

            if (err) throw err;
            if (result > 0) {
                req.USER_EMAIL = result[0].email;
                req.USER_ROLE = result[0].role;                
            }else{
                req.USER_ROLE = 'Guest';
            }

            next();
        });

    } else {
        res.status(400).json({ message: "Invalid Email" });
    }*/
};
const getImages = async (req, res, next) => {


    //GET RANDOM PICS USING PEXELS API

    let query = req.query;
    let limit = 5;
    if ("limit" in query) {
        if (query.limit < 11) {
            limit = query.limit;
        } else {
            limit = 10;
        }

    }

    let urls = [];
    let urlArray = [];

    console.log("Limit", limit);
    for (var i = 0; i < limit; i++) {
        await getPexels.photos.random({ query: "Random", per_page: limit }).then((photos) => {
            urls.push(photos.src.medium);
        });
    }
    req.LIMITS = limit;
    req.RAW_URLS = urlArray;
    req.URL_ARRAY = urls;

    next();


};
const fileTransfer = async (req, res, next) => {


    //TRANSFER THE PICS TO CLOUDINARY

    let url = req.URL_ARRAY;
    let cloud_url = [];
    for (var i = 0; i < req.LIMITS; i++) {
        await cloudinary.uploader.upload(url[i], { folder: "Ehrlich" }, (err, result) => {
            if (err) {
                res.status(500).end("Upload Failed")
            } else {
                console.log(result);
                let obj = {
                    hits: 1,
                    url: result.secure_url,
                    public_id: result.public_id
                }
                cloud_url.push(obj);
            }

        });
    }


    req.CLOUD_URL = cloud_url;

    next();


};
const fetchTables = (req, res, next) => {

    //INSERT URL's AND RETURN THE ITEMS

    let sql = `INSERT INTO tbl_files (url, hits, user_email, public_id) VALUES ?`
    let values = [];

    req.CLOUD_URL.forEach((key) => {
        let arr = [key.url, key.hits, req.USER_EMAIL, key.public_id];
        values.push(arr);
    });
    connect.query(sql, [values], (err, result, fields) => {
        if (err) throw err;
        let sql = `SELECT id, url, hits FROM tbl_files WHERE user_email = '${req.USER_EMAIL}'`
        connect.query(sql, (err, results, fields) => {
            if (err) throw err;
            let fileData = [];
            results.forEach((key) => {
                fileData.push(key);
            })
            req.FILE_DATA = fileData;
            next();
        });

    });




};

route.get('/images', jsonParser, verifyUser, getImages, fileTransfer, fetchTables, (req, res) => {

    let mainObject = {
        limit: req.LIMITS,
        data: req.FILE_DATA
    }
    res.status(200).json(mainObject);

});

const searchFile = (req, res, next) => {

    //FOR SEARCHING FILES IN THE DATABASE

    let fileId = req.params.id;
    console.log(fileId);
    let sql = `SELECT id, url, hits, public_id  FROM tbl_files WHERE id = ${fileId} AND user_email = '${req.USER_EMAIL}' LIMIT 1 `;

    connect.query(sql, (err, result) => {

        if (err) throw err;


        if (result.length > 0) {

            let sql = `UPDATE tbl_files SET hits = hits +1 WHERE id = ${fileId}`;

            connect.query(sql, (err, results) => {
                if (err) throw err;

                if (results.affectedRows > 0) {
                    req.FULL_FILE_DATA = result[0];
                    // delete result[0].public_id;
                    req.FILE_DATA = result[0];

                    next();
                } else {
                    res.status(500).end('Fetching Failed.');
                }

            });

        } else {
            res.status(401).end('Invalid File ID.')
        }

    });


}

route.get('/images/:id', jsonParser, verifyUser, searchFile, (req, res) => {
    let fileData = req.FILE_DATA;
    delete fileData.public_id;
    res.status(200).json(fileData);
});



const updateContents = (req, res, next) => {

    let fileData = req.FULL_FILE_DATA;
    let fileId = req.params.id;
    let fields = req.body;

    destroyFile(fileData.public_id);
    let uploadFile = addSingleFile(fields.url)

    req.UPDATE_CONTENTS = [{
        url: uploadFile.secure_url,
        public_id: uploadFile.public_id,
        hits: fields.hits
    }];

    next();

};

const updateTables = (req, res, next)=>{

    let fileId = req.FULL_FILE_DATA.id;

    let sql = `UPDATE tbl_files SET ? WHERE id = '${fileId}'`;
    
    connect.query(sql, req.UPDATE_CONTENTS[0], (err, result)=>{

        if(err) throw err;
        
        if(result.affectedRows > 0){
            next();
        }else{
            res.status(500).end('Update Failed');
        }

    })



};



route.patch('images/:id', jsonParser, verifyUser, searchFile, updateContents, updateTables,(req, res) => {
    
    let fileData = req.UPDATE_CONTENTS;
    delete fileData.public_id;
    res.status(204).json(fileData);
    
});














route.get('/sandbox/:id', jsonParser, verifyUser, searchFile, (req, res) => {
    console.log(req.FULL_FILE_DATA);

    let file = req.FULL_FILE_DATA;
    let be = destroyFile(file.public_id);


    res.end('P');


})



module.exports = route;
