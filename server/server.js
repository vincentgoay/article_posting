/// --- Load Libraries
const fs = require('fs')
const mysql = require('mysql');
const express = require('express');
const hbs = require('express-handlebars');
const morgan = require('morgan');
const aws = require('aws-sdk');
const multer = require('multer');
const uuid = require('uuid');

const db = require('./dbutil');
const spaces = require('./dospaces.config');

/// --- Configurations
// mySQL setup
let config;
if (fs.existsSync(__dirname + '/config.js')) {
    // Use local config file
    config = require(__dirname + '/config');
    config.ssl = {
        ca: fs.readFileSync(config.cacert)
    };
} else {
    // Use cloud config file
    config = {
        host: 'db-mysql-sgp1-75943-do-user-6725284-0.db.ondigitalocean.com',
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: 'mystore',
        connectionLimit: 4,
        cacert: process.env.DB_CA_CERT
    };
}

// Digital Ocean Spaces S3 setup connection
let s3Config;
if (fs.existsSync(__dirname + '/dospaces.config.js')) {
    s3Config = require('./dospaces.config');
} else {
    s3Config = {
        accessKeyId: process.env.S3_ACCESS_KEY,
        secretAccessKey: process.env.S3_SECRET_KEY
    }
}
const SPACE_URL = 'sgp1.digitaloceanspaces.com';
const s3 = new aws.S3({
    endpoint: new aws.Endpoint(SPACE_URL),
    accessKeyId: s3Config.public,
    secretAccessKey: s3Config.secret
});

// Create resources
const pool = mysql.createPool(config);  // mysql
const upload = multer({ dest: __dirname + '/tmp' }); // multer file parser
const PORT = parseInt(process.argv[2] || process.env.APP_PORT || process.env.PORT) || 3000;

// SQL Statements
const INSERT_NEW_ARTICLE = 'INSERT INTO articles(art_id, title, email, article, posted, image_url) values(?, ?, ?, ?, ?, ?)';
const insertNewArticle = db.mkQuery(INSERT_NEW_ARTICLE);

const GET_ALL_ARTICLES = 'select * from articles';
const getAllArticles = db.mkQueryFromPool(db.mkQuery(GET_ALL_ARTICLES), pool);

const app = express();

// Standard middlewares setup
app.use(morgan('tiny'));
app.engine('hbs', new hbs());

// Handlebars
app.engine('hbs', hbs({ defaultLayout: 'main.hbs' }));
app.set('view engine', 'hbs');

/// --- Routes
//
app.get('/articles',
    (req, res) => {
        getAllArticles()
            .then(result => {
                res.status(200).type('text/html').render('articles', { articles: result });
            })
            .catch(err => {
                return res.status(400).type('text/plain').send(`Error ${err}`);
            })
    }
)

// 
app.post('/article',
    upload.single('image-file'),
    (req, res) => {
        console.log('Body: ', req.body);
        console.log('File: ', req.file);

        pool.getConnection((err, conn) => {
            if (err) return res.status(500).type('text/plain').send(`Error: ${err}`);
            db.startTransaction(conn)
                .then(status => {
                    console.log('>> inserting article... ');
                    const body = req.body;
                    const art_id = uuid().substring(0, 8);
                    const postDate = new Date();

                    const params = [art_id, body.title, body.email, body.article, postDate, req.file.filename];
                    return (insertNewArticle({ connection: status.connection, params: params }))
                })
                .then(status => {
                    return new Promise(
                        (resolve, reject) => {
                            fs.readFile(req.file.path, (err, imgFile) => {
                                if (err) return reject({ connection: status.connection, error: err })
                                console.log('>> uploading image... ');
                                const params = {
                                    Bucket: 'paf-2019-example',
                                    Key: `articles/${req.file.filename}`,
                                    Body: imgFile,
                                    ACL: 'public-read',
                                    ContentType: req.file.mimetype
                                };

                                s3.putObject(params, (err, result) => {
                                    if (err)
                                        return reject({ connection: status.connection, error: err })
                                    resolve({ connection: status.connection, result });
                                })
                            })
                        }
                    )
                })
                .then(db.commit, db.rollback)
                .then(
                    (status) => {
                        return new Promise(
                            (resolve, reject) => {
                                console.log('>> unlinking file ', req.file.filename);
                                fs.unlink(req.file.path, () => {
                                    res.status(201).type('text/plain').send(`Posted article ${req.body.title}`);
                                })
                                resolve();
                            }
                        )
                    },
                    (status) => {
                        res.status(400).type('text/plain').send(`Error: ${status.error}`);
                    }
                )
                .finally(() => conn.release())
        })
    }
)

app.use(express.static(__dirname + '/public'));

/// --- start the application
pool.getConnection(
    (err, conn) => {
        if (err) {
            console.error('Cannot get database: ', err);
            return process.exit(0);
        }
        conn.ping(err => {
            if (err) {
                console.error('Cannot ping database: ', err);
                return process.exit(0);
            }

            app.listen(PORT, () => {
                console.log(`Application started on ${PORT} at ${new Date()}`);
            })
        })
    }
)