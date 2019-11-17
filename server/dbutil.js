
const mkQueryFromPool = (qObj, pool) => {
    return params => {
        return new Promise(
            (resolve, reject) => {
                pool.getConnection((err, conn) => {
                    conn.release();
                    if (err)
                        return reject(err);
                    qObj({ connection: conn, params: params || [] })
                        .then(status => { resolve(status.result); })
                        .catch(status => { reject(status.error); })
                })
            }
        )
    }
}

const mkQuery = (sql) => {
    return status => {
        const conn = status.connection;
        const params = status.params || [];

        return new Promise(
            (resolve, reject) => {
                conn.query(sql, params,
                    (error, result) => {
                        if (error)
                            return reject({
                                connection: conn,
                                error: error
                            })
                        resolve({
                            connection: conn,
                            result: result
                        })
                    })
            })
    }
}

const startTransaction = (connection) => {
    return new Promise(
        (resolve, reject) => {
            connection.beginTransaction(
                error => {
                    if (error)
                        return reject({ connection, error })
                    resolve({ connection });
                }
            )
        }
    )
}

const commit = status => {
    const conn = status.connection;

    return new Promise(
        (resolve, reject) => {
            console.log('>> in committing');
            conn.commit(err => {
                if (err)
                    return reject({
                        connection: status.connection,
                        error: err
                    })
                resolve({
                    connection: status.connection
                })
            })
        })
}

const rollback = status => {
    const conn = status.connection;

    return new Promise(
        (resolve, reject) => {
            console.log('>> in rollback');
            conn.rollback(err => {
                if (err)
                    return reject({
                        connection: status.connection,
                        error: err
                    })
                reject({
                    connection: status.connection,
                    error: status.error
                })
            })
        })
}

// Logging Utils
const passthru = (status) => { Promise.resolve(status)};
const logError = (status) => {
    return new Promise(
        (resolve, reject) => {
            console.log('Error :', status.error);
            reject(status);
        }
    )
}

module.exports = { mkQueryFromPool, mkQuery, startTransaction, commit, rollback, passthru, errorLog: logError };
