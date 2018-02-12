const express = require('express');
const router = express.Router();

const User = require('../db/models/User.js');
const Account = require('../db/models/crypto/Account.js');

const mongoose = require('mongoose');
const passport = require('passport');
const config = require('../config/database');
require('../config/passport')(passport);
const jwt = require('jsonwebtoken');
const multer  = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config_crypto = require('../config/crypto');

const Review = require('../db/models/Review.js');
const Deal = require('../db/models/Deal.js');
const Notification = require('../db/models/Notification.js');

// todo: set multer dest into memory storage for validate image width and height
const upload = multer({dest: 'public/profile-pic', fileFilter: (req, file, cb) => {
    // todo: file filtering (file type, file size, etc.)
    cb(null, true);
}}).single('profileImg');

const validator = require('express-validator');

const hash = text => crypto.createHash('sha1').update(text).digest('base64');

const createAccount = data => new Account(data).save();

router.use(validator({
    customValidators: {
        isUsernameAvailable: username => {
            return new Promise((resolve, reject) => {
                    User.findOne({username: username})
                        .then(doc => {
                            if (!doc) {
                                resolve();
                            } else {
                                reject();
                            }
                        }, err => {
                            resolve();
                        })
            });
        },
        isEmailAvailable: email => {
            return new Promise((resolve, reject) => {
                User.findOne({email: email})
                    .then(doc => {
                        if (!doc || doc.status === 'invited') {
                            resolve();
                        } else {
                            reject();
                        }
                    }, err => {
                        resolve();
                    })
            });
        },
        isAvailable: (email, type) => {
            return new Promise((resolve, reject) => {
                User
                    .findOne({
                        $and: [
                            {email: email},
                            {type: type}
                        ]
                    })
                    .then(doc => {
                        if (!doc || doc.status === 'invited') {
                            resolve();
                        } else {
                            reject();
                        }
                    }, err => {
                        resolve();
                    })
            });
        }
    }
}));

module.exports = web3 => {

    router.get('/getinv/:invId',  (req, res) => {
        User.findById(req.params.invId).select('email type').then(doc => {
            if (!doc) {
                return res.status(401).json({success: false, msg: 'Wrong params'});
            }
            return res.json(doc);
        }).catch(err => res.status(500).json(err));
    });

    router.post('/acceptinv/:invId', (req, res) => {
        req.checkBody({
            username: {
                notEmpty: {
                    errorMessage: 'Username is required'
                },
                isUsernameAvailable: {
                    errorMessage: 'This username is already taken'
                }
            },
            password: {
                notEmpty: {
                    errorMessage: 'Password is required'
                },
                isLength: {
                    options: {
                        min: 6
                    },
                    errorMessage: 'Passwords must be at least 6 chars long'
                }
            }
        });
        req.getValidationResult().then(result => {
            if (result.array().length > 0) {
                return res.status(400).json({success: false, errors: result.mapped(), msg: 'Bad request'});
            }
            User.findByIdAndUpdate(req.params.invId, {
                username: req.body.username,
                password: hash(req.body.password),
                status: 'active'
            })
                .then(user => {
                    return user.sendMailVerification();
                })
                .then(async user => {
                    // generate wallet (eth and erc20 only now)
                    let newAccount = web3.eth.accounts.create();
                    let account = await createAccount({
                        address: newAccount.address,
                        privateKey: newAccount.privateKey,
                        coin: 'eth',
                        owner: user._id
                    });
                    user.wallet = account._id;
                    await user.save();
                    // generate jwt
                    let payload = {
                        _id: user._id,
                        username: user.username,
                        email: user.email,
                        type: user.type,
                    };
                    let token = jwt.sign(payload, config.secret, {
                        expiresIn: 60 * 60 * 24 * 3 // expires in 3 days
                    });
                    return res.json({success: true, token: 'JWT ' + token});
                })
                .catch(err => res.status(500).json({success: false, error: [err], msg: 'DB Error'}));
        });
    });

    router.post('/login', async (req, res, next) => {
        req.checkBody({
            email: {
                notEmpty: {
                    errorMessage: 'Email is required'
                },
                isEmail: {
                    errorMessage: 'Invalid email'
                }
            },
            password: {
                notEmpty: {
                    errorMessage: 'Password is required'
                }
            }
        });
        const result = await req.getValidationResult();
        if (result.array().length > 0) {
            return res.status(400).json({success: false, errors: result.mapped(), msg: 'Bad request'});
        }
        User.findOne({
            $and: [
                {email: req.body.email},
                {type: req.body.type}
            ]
        }, (err, user) => {
            if (err) throw err;

            if (!user) {
                res.status(401).send({success: false, msg: 'Authentication failed. Wrong email or password.'});
            } else {
                // check if password matches
                if (user.comparePassword(req.body.password)) {
                    // if user is found and password is right create a token
                    let payload = {
                        _id: user._id,
                        username: user.username,
                        email: user.email,
                        type: user.type,
                    };
                    let token = jwt.sign(payload, config.secret, {
                        expiresIn: 60 * 60 * 24 * 3 // expires in 3 days
                    });
                    return res.json({success: true, token: 'JWT ' + token});
                } else {
                    return res.status(401).send({
                        success: false,
                        msg: 'Authentication failed. Wrong email or password.'
                    });
                }
            }
        });

    });

    router.post('/register', async (req, res) => {
        try {
            req.checkBody({
                username: {
                    notEmpty: {
                        errorMessage: 'Username is required'
                    },
                    isUsernameAvailable: {
                        errorMessage: 'This username is already taken'
                    }
                },
                /*email: {
                    notEmpty: {
                        errorMessage: 'Email is required'
                    },
                    isEmail: {
                        errorMessage: 'Invalid email'
                    },
                    isEmailAvailable: {
                        errorMessage: 'This email is already taken'
                    }
                },*/
                password: {
                    notEmpty: {
                        errorMessage: 'Password is required'
                    },
                    isLength: {
                        options: {
                            min: 6
                        },
                        errorMessage: 'Passwords must be at least 6 chars long'
                    }
                },
                type: {
                    notEmpty: {
                        errorMessage: 'Account type is required'
                    },
                    isIn: {
                        options: [['client', 'escrow', 'trust']],
                        errorMessage: 'Unknown account type'
                    }
                }
            });

            req
                .checkBody('email')
                .notEmpty().withMessage('Email is required')
                .isEmail().withMessage('Invalid email')
                .isAvailable(req.body.type).withMessage('This email is already taken');

            const result = await req.getValidationResult();
            if (result.array().length > 0) {
                return res.status(400).json({success: false, errors: result.mapped(), msg: 'Bad request'});
            }

            let user = await new User({
                _id: new mongoose.Types.ObjectId(),
                username: req.body.username,
                email: req.body.email,
                password: hash(req.body.password),
                type: req.body.type
            }).save();

            user = await user.sendMailVerification();

            // generate wallet (eth and erc20 only now)
            let newAccount = web3.eth.accounts.create();
            let account = await createAccount({
                address: newAccount.address,
                privateKey: newAccount.privateKey,
                coin: 'eth',
                owner: user._id
            });
            user.wallet = account._id;
            await user.save();
            // generate jwt token
            let payload = {
                _id: user._id,
                username: user.username,
                email: user.email,
                type: user.type,
            };
            let token = jwt.sign(payload, config.secret, {
                expiresIn: 60 * 60 * 24 * 3 // expires in 3 days
            });
            return res.json({success: true, token: 'JWT ' + token});
        } catch (err) {
            return res.status(500).json({success: false, error: [err], msg: 'DB Error'});
        }
    });

    router.post('/profile', passport.authenticate('jwt', {session: false}), async (req, res) => {
        try {
            const doc = await User.findById(req.user._id).select('-password');
            if (!doc) {
                return res.status(401).send({success: false, msg: 'Authentication failed. User not found.'});
            }
            upload(req, res, async (err) => {
                if (err) {
                    // An error occurred when uploading
                    return res.status(500).json(err);
                }
                let old_avatar = null;
                if (doc.profileImg) {
                    old_avatar = doc.profileImg;
                }
                doc.profileImg = req.file.filename;
                await doc.save();
                if (old_avatar) {
                    fs.unlink(path.resolve('public/profile-pic/' + old_avatar), err => {
                        if (err) {
                            return res.status(500).json(err);
                        }
                        return res.json(doc);
                    });
                } else {
                    return res.json(doc);
                }
            });
        } catch (err) {
            return res.status(500).json(err);
        }
    });


    router.get('/info', passport.authenticate('jwt', {session: false}), async (req, res) => {
        try {
            const doc = await User.findById(req.user._id).select("-password").populate('wallet');
            if (!doc) {
                return res.status(401).send({success: false, msg: 'Authentication failed. User not found.'});
            }
            const user = {
                _id: doc._id,
                username: doc.username,
                email: doc.email,
                type: doc.type,
                holds: doc.holds,
                status: doc.status,
                profileImg: doc.profileImg
            };
            if (doc.status === 'unverified') {
                user.type = 'unverified-user';
            }
            if (!user.profileImg) {
                user.profileImg = config.backendUrl + '/images/default-user-img.png';
            } else {
                user.profileImg = config.backendUrl + '/profile-pic/' + doc.profileImg;
            }
            user.balances = {};

            // coins balances
            for (let coin in config_crypto) {
                if (!config_crypto.hasOwnProperty(coin)) {
                    continue;
                }
                switch (config_crypto[coin].type) {
                    case 'erc20':
                        const contract = new web3.eth.Contract(require('../abi/' + coin + '/Token.json'), config_crypto[coin].address);
                        user.balances[coin] = await contract.methods.balanceOf(doc.wallet.address).call();
                        user.balances[coin] = user.balances[coin] / Math.pow(10, config_crypto[coin].decimals);
                        break;

                    case 'eth':
                        user.balances.eth = web3.utils.fromWei(await web3.eth.getBalance(doc.wallet.address));
                        break;
                }
            }
            user.address = doc.wallet.address;
            return res.json(user);
        } catch (err) {
            return res.status(500).json(err);
        }
    });
    router.post('/user/:id/addReview', passport.authenticate('jwt', {session: false}), (req, res) => {
        req.checkBody({
            comment: {
                notEmpty: {
                    errorMessage: 'Comment is required'
                }
            },
            rating: {
                notEmpty: {
                    errorMessage: 'Set the rating value from 1 to 5'
                },
                isIn: {
                    options: [['1', '2', '3', '4', '5']],
                    errorMessage: 'Set the rating value from 1 to 5'
                }
            }
        });
        req.getValidationResult().then(result => {
            if (result.array().length > 0) {
                return res.status(400).json({success: false, errors: result.mapped(), msg: 'Bad request'});
            }

            Review.findOne({
                $and: [
                    {author: req.user._id},
                    {deal: req.body.deal_id}
                ]
            }).then(doc => {
                if (doc){
                    throw {msg: 'You can leave only one review for one deal'};
                }

                return Deal.find(
                    {$and: [
                        {
                            $or: [{
                                'buyer': req.user._id
                            }, {
                                'seller': req.user._id
                            }]
                        },
                        {_id: req.body.deal_id}
                    ]});
            }).then(deal => {
                let review = {
                    _id: new mongoose.Types.ObjectId(),
                    user: req.params.id,
                    author: req.user._id,
                    comment: req.body.comment,
                    rating: req.body.rating,
                    deal: req.body.deal_id
                };
                return new Review(review).save();
            }).then(data => {
                return res.json({success: true, msg: 'Thanks for review!'});
            }).catch(err => {
                console.log('Add Review method error: ', err);
                return res.status(500).json({success: false, error: [err], msg: err.msg ? err.msg : 'DB Error'});
            });
        });
    });

    router.get('/user/:id', passport.authenticate('jwt', {session: false}), (req, res) => {
        User.findOne({
            _id: req.params.id
        }).select('-password').then(user => {
            return new Promise((resolve, reject) => {
                if (!user.profileImg) {
                    user.profileImg = config.backendUrl + '/images/default-user-img.png';
                } else {
                    user.profileImg = config.backendUrl + '/profile-pic/' + doc.profileImg;
                }
                Review.find({user: user._id}).populate('author', ['-password', '-wallet']).then(reviews => {
                    resolve({user: user, reviews: reviews});
                }).catch(err => {
                    reject(err);
                });
            });
        }).then(data => {
            return res.json(data);
        }).catch(err => {
            console.log(err);
        });
    });

    router.get('/user/:id/review', passport.authenticate('jwt', {session: false}), (req, res) => {
        Review.find({
            user: req.params.id
        }).populate('author', '-password').then(review => {
            return res.json(review);
        }).catch(err => {
            console.log(err);
        });
    });


    router.get('/sendVerify', passport.authenticate('jwt', {session: false}), function (req, res) {
        User
            .findOne({_id: req.user._id, status: 'unverified'})
            .then(user => {
                if (!user) {
                    throw {
                        msg: 'User is already verified'
                    }
                }

                return user.sendMailVerification();
            })
            .then(user => {
                return res.json({msg: 'Please check email and verify your account.'});
            })
            .catch(err => {
                return res.status(400).json({success: false, error: err});
            })
    });

    router.get('/verify/:code', (req, res) => {
        if (!req.params.code) {
            return res.status(404).json({success:false, error: {msg:'Empty verify code'}});
        }
        User
            .findOne({verifyCode: req.params.code})
            .then(user => {
                if (!user) {
                    throw {
                        msg: 'This session is not found'
                    };
                }
                
                user.verifyCode = null;
                user.status = 'active';
                return user.save();
            })
            .then(user => res.json({success: true}))
            .catch(err => res.status(400).json({success: false, error: err}));
    });

    router.post('/reset', async (req, res) => {
        try {
            req.checkBody({
                email: {
                    notEmpty: {
                        errorMessage: 'Email is required'
                    },
                    isEmail: {
                        errorMessage: 'Invalid email'
                    }
                }
            });

            const result = req.getValidationResult();
            if (result.array().length > 0) {
                return res.status(400).json({success: false, errors: result.mapped(), msg: 'Bad request'});
            }
            const user = User.findOne({email: req.body.email});

            if (!user) {
                return res.status(401).json({success: false, error: 'User not found'});
            }

            await user.sendMailReset();

            return res.json({success: true});

        } catch (err) {
            return res.status(401).json({success: false, error: err});
        }
    });

    router.get('/reset/:code', (req, res) => {
        if (!req.params.code) {
            return res.status(404).json({success:false, error: {msg:'Empty reset code'}});
        }
        User
            .findOne({changePwdCode: req.params.code})
            .then(user => {
                if (!user) {
                    throw {
                        msg: 'This session is not found'
                    };
                }
                return res.json({success: true, email: user.email});
            })
            .catch(err => {
                return res.status(400).json({success: false, error: err});
            });
    });

    router.post('/reset/:code', (req, res) => {
        if (!req.params.code) {
            return res.status(404).json({success:false, error: {msg:'Empty reset code'}});
        }
        req.checkBody({
            password: {
                notEmpty: {
                    errorMessage: 'Password is required'
                },
                isLength: {
                    options: {
                        min: 6
                    },
                    errorMessage: 'Passwords must be at least 6 chars long'
                }
            }
        });

        req.getValidationResult().then(result => {
            if (result.array().length > 0) {
                return res.status(400).json({success: false, errors: result.mapped(), msg: 'Bad request'});
            }
            User
            .findOne({changePwdCode: req.params.code})
            .then(user => {
                if (!user) {
                    throw {
                        msg: 'This session is not found'
                    };
                }

                user.password = hash(req.body.password);
                user.changePwdCode = null;
                return user.save();
            })
            .then(user => res.json({success: true}))
            .catch(err => res.status(400).json({success: false, error: err}));
        });
    });

    router.get('/notifications', passport.authenticate('jwt', {session: false}), (req, res) => {
        Notification
            .aggregate([
                {
                    $match: {
                        $and: [
                            {type: 'message'},
                            {user: mongoose.Types.ObjectId(req.user._id)}
                        ]
                    }
                },
                {
                    $group: {
                        _id: '$deal',
                        notifications: {
                            $sum: 1
                        },
                        created_at: {
                            $max: '$created_at'
                        }
                    }
                },
                {
                    $lookup: {
                        from: 'deals',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'deal'
                    }
                },
                {
                    $unwind: '$deal'
                },
                {
                    $project: {
                        _id: 0,
                        created_at: 1,
                        deal: 1,
                        notifications: 1,
                        type: 'message'
                    }
                }
            ])
            .then(notifications => {
                Notification
                    .find({
                        $and: [
                            {
                                type: {
                                    $ne: 'message'
                                }
                            },
                            {
                                user: req.user._id
                            }
                        ]
                    })
                    .populate('sender', 'username')
                    .populate({path: 'deal', populate: [{path: 'exchange', select: ['tradeType']}]})
                    .then(_notifications => {
                        for (let i = 0; i < notifications.length; i++) {
                            _notifications.push(notifications[i]);
                        }
                        
                        _notifications.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                        return res.json(_notifications);
                    })
                    .catch(err => {
                        return res.status(400).json({success: false, error: err});
                    })
            });
    });

    return router;
};