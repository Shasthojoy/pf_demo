<template>
    <div id="exchange">
        <div class="container">
            <b-row>
                <b-col sm="12" md="7">
                    <b-card :header="'Exchange #' + id">
                        <div class="info">
                            <p><b>Owner:</b> {{owner.username}}</p>
                            <p><b>Coin:</b> {{coin}}</p>
                            <p><b>Currency:</b> {{currency}}</p>
                            <p><b>Payment:</b> {{paymentType}}{{paymentTypeDetail ? ' (' + paymentTypeDetail + ')' : ''}}</p>
                            <p><b>Rate:</b> {{rate}}</p>
                            <p><b>Created at:</b> {{created_at}}</p>
                            <p><b>Status:</b> {{status}}</p>
                            <p><b>Conditions:</b> <br>{{conditions}}</p>
                            <p><b>Limits:</b> {{limits.min}} - {{limits.max}}</p>
                        </div>
                        <b-form-group 
                            v-if="owner.username !== $auth.user().username"
                            id="sumInputGroup" 
                            label="Input sum:" 
                            label-for="sum"
                            :feedback="errorMessage('sum')"
                        >
                            <b-form-input 
                                id="sum" 
                                step="any" 
                                v-model="sum"
                                :state="isValid('sum')"
                            >
                            </b-form-input>
                        </b-form-group>
                        <div v-if="$auth.check()">
                            <b-button disabled v-if="owner.username == $auth.user().username || status == 'closed'">
                                {{tradeType == 'buy' ? 'sell' : 'buy'}}
                            </b-button>
                            <b-button v-if="owner.username != $auth.user().username && status != 'closed'" variant="primary" @click.prevent="acceptExchange">
                                {{tradeType == 'buy' ? 'sell' : 'buy'}}
                            </b-button>
                        </div>
                        <div v-if="!$auth.check()">
                            Please sign in to {{tradeType}} Coins: <router-link :to="{name: 'login'}" class="btn btn-success">Login</router-link>
                        </div>
                    </b-card>
                </b-col>
                <b-col sm="12" md="5">
                    <b-card :header="owner.username + ' reviews'">
                        <h5><b>Total Rating: </b>{{averageRating}}</h5>
                        <hr>
                        <div v-for="review in newreviews" class="review">
                            <p>
                                <b>By:</b> <router-link :to="{name: 'user-by-id', params: {id: review.author._id}}">{{review.author.username}}</router-link><br>
                                <!-- <b>Rating:</b> {{review.rating}}<br>
                                <b>Comment:</b><br> -->
                            </p>
                            <p class="float-left">Rating:</p>
                            <div v-for="i in review.rating">
                                <span></span>
                            </div>
                            <p>{{review.comment}}</p>
                            <p v-if="isToday(review.created_at)" class="date">Today, {{review.created_at | moment("HH:mm:ss")}}</p>
                            <p v-if="!isToday(review.created_at)" class="date">{{review.created_at | moment("MMMM Do YYYY, HH:mm:ss")}}</p>
                            <hr>
                        </div>
                        <b-pagination :total-rows="totalRows" :per-page="perPage" v-model="currentPage" @input="getReview" />
                    </b-card>
                </b-col>
            </b-row>
            <b-row>
                <b-col sm="12" md="7">
                </b-col>

                <b-col sm="12" md="5">
                    <div class="wel-inner text-center">
                        <a style="font-weight: bolder; font-size: large">Total sum of the deal = {{+(sum * rate).toFixed(8)}}</a>
                    </div>
                </b-col>
            </b-row>
        </div>
    </div>
</template>
<script>
export default {
    name: 'Exchange',
    props: ['id'],
    created: function(){
        this.getExchange();
    },
    data: function(){
        return {
            owner: {
                username: ''
            },
            tradeType: '',
            coin: '',
            currency: '',
            paymentType: '',
            paymentTypeDetail:'',
            rate: '',
            limits: {
                max: 0,
                min: 0
            },
            created_at: '',
            status: '',
            conditions: '',
            reviews: [],
            totalRating: 0,
            errors: {},
            errorMsg: '',
            sum: 0,
            newreviews: [],
            currentPage: 1,
            perPage: 2,
            totalRows: 0,
        }
    },
    methods: {
        getExchange: function(){
            const vm = this;
            const limit = vm.perPage;
            const offset = (vm.currentPage - 1) * vm.perPage;
            const sort = "created_at";
            const order = "true";
            var ownerNumber;
            this.$http.get('/exchanges/' + this.id).then(function(response){
                let exch = response.data.exchange;
                vm._id = exch._id;
                vm.coin = exch.coin;
                vm.limits = exch.limits;
                vm.conditions = exch.conditions;
                vm.created_at = (new Date(exch.created_at)).toLocaleString();
                vm.currency = exch.currency;
                vm.owner = exch.owner;
                ownerNumber = exch.owner._id;
                vm.paymentType = exch.paymentType;
                vm.rate = exch.rate;
                vm.status = exch.status;
                vm.tradeType = exch.tradeType;
                vm.paymentTypeDetail = exch.paymentTypeDetail;
                vm.reviews = response.data.reviews;

                if (vm.reviews.length > 0){
                    for (let i in vm.reviews){
                        vm.totalRating += vm.reviews[i].rating;
                    }
                } else {
                    vm.totalRating = 0;
                }
                vm.totalRating /= vm.reviews.length;
            }).then(function(){
                vm.$http.get('/users/user/' + ownerNumber + '/getreview?limit='+limit+'&offset='+offset+'&sortBy='+sort+'&order='+order).then(response => {
                    vm.newreviews = response.data.data;
                    vm.totalRows = response.data.total;
                    return (response.data.data || []);
                }, err => {
                    console.log(err);
                });
            });
        },
        acceptExchange: function(e){
            const vm = this;

            this
                .$http
                .post('/deals/exchange', {exchange: this._id, sum: this.sum, exchange_id: vm.id})
                .then(
                    response => {
                        vm.$router.push({name: 'deal', params: {id: response.data.deal.dId}});
                        vm.$swal('Success', 'Deal was created', 'success');
                    }, 
                    err => {
                        if (err.response.status === 400) {
                            vm.errors = err.response.data.errors;
                        }
                    }
                );
        },
        getReview: function(ctx){
            const vm = this;
            const limit = vm.perPage;
            const offset = (vm.currentPage - 1) * vm.perPage;
            const sort = "created_at";
            const order = "true";
                return this.$http.get('/users/user/' + this.owner._id + '/getreview?limit='+limit+'&offset='+offset+'&sortBy='+sort+'&order='+order).then(response => {
                    vm.newreviews = response.data.data;
                    vm.totalRows = response.data.total;
                    return (response.data.data || []);
                }, err => {
                    console.log(err);
                });
        },
        isValid: function (key) {
            return this.errors.hasOwnProperty(key) ? 'invalid' : '';
        },
        errorMessage: function(key) {
            return this.errors.hasOwnProperty(key) ? this.errors[key].msg : '';
        },
        isToday(date) {
            date = new Date(date);
            return new Date().toLocaleDateString() === date.toLocaleDateString();
        }
    },
    watch: {
        'sum': function () {
            delete this.errors.sum;
        },
        '$route.fullPath'() {
            this.getReview();
        }
    },
    computed: {
        averageRating: function() {
            const vm = this;
            var review = 0;
            var totalRating = 0;
            var len = 0;
            for (var i = 0; i < vm.reviews.length; i++) {
                if (vm.reviews[i].rating != null) {
                    review = vm.reviews[i].rating;
                    totalRating += review;
                    len++;
                }
            }
            if (Object.keys(vm.reviews).length === 0) {
                return "no reviews";
            } else {
                return (Math.round(totalRating / len * 100) / 100);
            }
        }
    }
}
</script>
<style scoped>
.review span {
    width: 20px;
    height: 20px;
}
.review p{
    clear:both;
}
.review div{
    float: left;
    margin-left: 5px;
}
.date{
    font-style: italic;
}
</style>
