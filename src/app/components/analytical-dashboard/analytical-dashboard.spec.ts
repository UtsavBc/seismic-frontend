import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticalDashboard } from './analytical-dashboard';

describe('AnalyticalDashboard', () => {
  let component: AnalyticalDashboard;
  let fixture: ComponentFixture<AnalyticalDashboard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalyticalDashboard],
    }).compileComponents();

    fixture = TestBed.createComponent(AnalyticalDashboard);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
