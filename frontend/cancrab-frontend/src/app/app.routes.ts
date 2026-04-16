import { Routes } from '@angular/router';
import { WsDemoComponent } from './ws-demo/ws-demo.component';
import { LandingComponent } from './landing/landing.component';
import { ResultsComponent } from './results/results.component';
import { LoginComponent } from './auth/login/login.component';
import { RegisterComponent } from './auth/register/register.component';

export const routes: Routes = [
  { path: '', component: LandingComponent },
  { path: 'results', component: ResultsComponent },
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  { path: 'ws-demo', component: WsDemoComponent },
];
