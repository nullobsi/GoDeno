type GoErr = {
    message: string;
    name: string;
    stack?: string;
    code: string;
}
const enosys = () => {
    const err = new Error("not implemented");
    const gErr: GoErr = {...err, code: "ENOSYS"}
    return gErr;
};

export default enosys;